import { safeFetch, SafeFetchError } from '@vast-tag/safe-fetch';
import { evaluateRules, resolveVast } from '@vast-tag/vast-core';
import type { FetchDocument, InspectionSource } from '@vast-tag/vast-core';
import type { InspectionRepository } from './inspection-repository.ts';

const fetchDocument: FetchDocument = async (url) => {
  try {
    return await safeFetch(url);
  } catch (error) {
    if (error instanceof SafeFetchError)
      return { errorCode: `FETCH_${error.code}` };
    throw error;
  }
};

interface Job {
  id: string;
  source: InspectionSource;
  repository: InspectionRepository;
}

export function createInspectionService({
  concurrency = 2,
  capacity = 16,
  fetch = fetchDocument,
} = {}) {
  const queue: Job[] = [];
  let active = 0;
  let outstanding = 0;

  async function run({ id, source, repository }: Job) {
    try {
      if (!(await repository.start(id))) return;
      const chain = await resolveVast(source, {
        fetchDocument: fetch,
        captureXmlPreview: true,
      });
      await repository.finish(id, chain, evaluateRules(chain));
    } catch {
      await repository.fail(id, 'INTERNAL_ERROR');
    }
  }

  function dispatch() {
    while (queue.length && active < concurrency) {
      const job = queue.shift();
      if (!job) return;
      active++;
      void run(job)
        .catch(() => console.error('Could not record inspection failure.'))
        .finally(() => {
          active--;
          outstanding--;
          dispatch();
        });
    }
  }

  return {
    async submit(
      repository: InspectionRepository,
      source: InspectionSource,
      createdBy: string,
    ) {
      if (outstanding >= capacity) return null;
      outstanding++;
      let id: string;
      try {
        id = await repository.create(source, createdBy);
      } catch (error) {
        outstanding--;
        throw error;
      }
      queue.push({ id, source, repository });
      dispatch();
      return id;
    },
  };
}

export type InspectionService = ReturnType<typeof createInspectionService>;
