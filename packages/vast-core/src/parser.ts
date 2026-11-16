import { XMLParser } from 'fast-xml-parser';

export const MAX_XML_BYTES = 1024 * 1024;
const MAX_XML_DEPTH = 48;

export interface Tracker {
  event: string;
  url: string;
}

export interface MediaFile {
  url: string;
  mimeType: string | null;
  codec: string | null;
  bitrateKbps: number | null;
}

export interface LinearCreative {
  id: string | null;
  durationSeconds: number | null;
  skipOffset: string | null;
  trackers: Tracker[];
  mediaFiles: MediaFile[];
}

interface AdContent {
  id: string | null;
  impressions: string[];
  creatives: LinearCreative[];
  verifications: { vendor: string | null; apiFramework: string | null }[];
}

export type VastAd = AdContent &
  (
    | { kind: 'inline' }
    | {
        kind: 'wrapper';
        adTagUri: string | null;
        followAdditionalWrappers: boolean;
      }
  );

export interface ParsedVast {
  version: string | null;
  ads: VastAd[];
}

export type ParseErrorCode =
  'XML_TOO_LARGE' | 'XML_DECLARATION_BLOCKED' | 'INVALID_XML' | 'NOT_VAST';
export type ParseResult =
  | { ok: true; value: ParsedVast; xmlPreview?: string }
  | { ok: false; code: ParseErrorCode };

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  ignoreDeclaration: true,
  ignorePiTags: true,
  removeNSPrefix: true,
  parseTagValue: false,
  maxNestedTags: MAX_XML_DEPTH,
});

function isNode(value: unknown): value is XmlNode {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function children(node: XmlNode | undefined, name: string): XmlNode[] {
  const value = node?.[name];
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function elements(
  node: XmlNode | undefined,
  parent: string,
  name: string,
): XmlNode[] {
  return children(node, parent).filter((child) => Array.isArray(child[name]));
}

function attr(node: XmlNode, name: string): string | null {
  const attrs = node[':@'];
  const value =
    isNode(attrs) && Object.hasOwn(attrs, name) ? attrs[name] : null;
  return typeof value === 'string' ? value.trim() || null : null;
}

function text(node: XmlNode, name: string): string {
  return children(node, name)
    .map((child) => (typeof child['#text'] === 'string' ? child['#text'] : ''))
    .join('')
    .trim();
}

function firstText(node: XmlNode, parent: string, name: string): string | null {
  const first = elements(node, parent, name)[0];
  return (first && text(first, name)) || null;
}

function durationSeconds(value: string | null): number | null {
  const match = value?.match(/^(\d{2,}):([0-5]\d):([0-5]\d(?:\.\d{1,3})?)$/);
  if (!match) return null;
  const seconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isSafeInteger(Math.ceil(seconds)) && seconds > 0
    ? seconds
    : null;
}

function readMediaFile(node: XmlNode): MediaFile {
  const bitrate = attr(node, 'bitrate');
  const value = bitrate && /^\d+$/.test(bitrate) ? Number(bitrate) : NaN;
  return {
    url: text(node, 'MediaFile'),
    mimeType: attr(node, 'type'),
    codec: attr(node, 'codec'),
    bitrateKbps: Number.isSafeInteger(value) && value > 0 ? value : null,
  };
}

function readLinear(node: XmlNode, id: string | null): LinearCreative {
  const trackingEvents = elements(node, 'Linear', 'TrackingEvents')[0];
  const mediaFiles = elements(node, 'Linear', 'MediaFiles')[0];
  return {
    id,
    durationSeconds: durationSeconds(firstText(node, 'Linear', 'Duration')),
    skipOffset: attr(node, 'skipoffset'),
    trackers: elements(trackingEvents, 'TrackingEvents', 'Tracking').map(
      (tracker) => ({
        event: attr(tracker, 'event') ?? '',
        url: text(tracker, 'Tracking'),
      }),
    ),
    mediaFiles: elements(mediaFiles, 'MediaFiles', 'MediaFile').map(
      readMediaFile,
    ),
  };
}

function readAd(node: XmlNode): VastAd | null {
  const inline = elements(node, 'Ad', 'InLine');
  const wrappers = elements(node, 'Ad', 'Wrapper');
  const body = inline[0] ?? wrappers[0];
  if (!body || inline.length + wrappers.length !== 1) return null;

  const tag = inline.length ? 'InLine' : 'Wrapper';
  const creativeList = elements(body, tag, 'Creatives')[0];
  const verifications = elements(body, tag, 'AdVerifications')[0];
  const content: AdContent = {
    id: attr(node, 'id'),
    impressions: elements(body, tag, 'Impression')
      .map((node) => text(node, 'Impression'))
      .filter(Boolean),
    creatives: elements(creativeList, 'Creatives', 'Creative').flatMap(
      (creative) =>
        elements(creative, 'Creative', 'Linear').map((linear) =>
          readLinear(linear, attr(creative, 'id')),
        ),
    ),
    verifications: elements(
      verifications,
      'AdVerifications',
      'Verification',
    ).map((verification) => {
      const script = elements(
        verification,
        'Verification',
        'JavaScriptResource',
      )[0];
      return {
        vendor: attr(verification, 'vendor'),
        apiFramework: script ? attr(script, 'apiFramework') : null,
      };
    }),
  };
  if (tag === 'InLine') return { ...content, kind: 'inline' };

  const follow = attr(body, 'followAdditionalWrappers');
  return {
    ...content,
    kind: 'wrapper',
    adTagUri: firstText(body, tag, 'VASTAdTagURI'),
    followAdditionalWrappers: follow !== 'false' && follow !== '0',
  };
}

const previewElements = new Set(
  'VAST Ad InLine Wrapper AdSystem AdTitle AdServingId Description Impression Error VASTAdTagURI Category Creatives Creative UniversalAdId Linear NonLinearAds CompanionAds Duration TrackingEvents Tracking MediaFiles MediaFile Mezzanine InteractiveCreativeFile ClosedCaptionFiles ClosedCaptionFile VideoClicks ClickThrough ClickTracking CustomClick Icons Icon AdParameters AdVerifications Verification JavaScriptResource ExecutableResource VerificationParameters Extensions Extension'.split(
    ' ',
  ),
);
const MAX_PREVIEW_LENGTH = 16 * 1024;
const PREVIEW_FOOTER = '<!-- Preview truncated -->';

function renderXmlPreview(root: XmlNode): string {
  let output = '';
  function write(node: XmlNode, name: string, indent: string) {
    const entries = children(node, name);
    const open = `${indent}<${name}>`;
    const close = `${indent}</${name}>\n`;
    const required = open.length + close.length + 1;
    if (output.length + required > MAX_PREVIEW_LENGTH - PREVIEW_FOOTER.length)
      return false;
    output += `${open}\n`;
    for (const entry of entries) {
      if (typeof entry['#text'] === 'string') {
        if (
          output.length + indent.length + 13 >
          MAX_PREVIEW_LENGTH - PREVIEW_FOOTER.length
        )
          return false;
        output += `${indent}  [redacted]\n`;
        continue;
      }
      const tag = Object.keys(entry).find((key) => previewElements.has(key));
      if (tag && !write(entry, tag, `${indent}  `)) return false;
    }
    if (
      output.length + close.length >
      MAX_PREVIEW_LENGTH - PREVIEW_FOOTER.length
    )
      return false;
    output += close;
    return true;
  }
  return write(root, 'VAST', '') ? output.trimEnd() : output + PREVIEW_FOOTER;
}

export function parseVast(xml: string, captureXmlPreview = false): ParseResult {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES)
    return { ok: false, code: 'XML_TOO_LARGE' };
  // Only predefined XML entities and numeric references are allowed.
  if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml))
    return { ok: false, code: 'XML_DECLARATION_BLOCKED' };

  let document: unknown;
  try {
    document = parser.parse(xml, true);
  } catch {
    return { ok: false, code: 'INVALID_XML' };
  }

  const roots = Array.isArray(document) ? document.filter(isNode) : [];
  const root = roots[0];
  if (roots.length !== 1 || !root) return { ok: false, code: 'INVALID_XML' };
  if (!Array.isArray(root.VAST)) return { ok: false, code: 'NOT_VAST' };

  const ads: VastAd[] = [];
  for (const node of elements(root, 'VAST', 'Ad')) {
    const ad = readAd(node);
    if (!ad) return { ok: false, code: 'INVALID_XML' };
    ads.push(ad);
  }
  const result: ParseResult = {
    ok: true,
    value: { version: attr(root, 'version'), ads },
  };
  if (captureXmlPreview) result.xmlPreview = renderXmlPreview(root);
  return result;
}
