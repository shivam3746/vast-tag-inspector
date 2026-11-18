# ADR 001 — SSRF protections and IP pinning

The CLI and API share a transport for public HTTPS URLs on port 443. Before each connection, resolve A and AAAA records and reject the hostname if any address is private or reserved. Check IP literals directly and handle redirects explicitly.

Pass the selected IP through a pinned lookup in Node's HTTPS client. A fresh connection uses that address while TLS verifies the original hostname and HTTP sends the original Host header. The DNS preflight and the connection would otherwise perform separate lookups, allowing the selected IP to change between the two steps.

Each redirect repeats the URL and address checks. One deadline covers DNS, redirects, and body reads, and each TCP/TLS connection has its own shorter deadline. The transport requests identity encoding, bounds response bytes, and accepts XML and plain-text media types. Use the redirect's final URL as the base for relative wrapper links.

The policy conservatively rejects IPv6 outside global unicast space and blocks special-purpose ranges inside it. General network egress policy remains a separate deployment control, especially in environments that route nominally public addresses to private services.

- [Node.js HTTPS](https://nodejs.org/api/https.html)
- [IANA IPv4 special-purpose address space](https://www.iana.org/assignments/iana-ipv4-special-registry)
- [IANA IPv6 special-purpose address space](https://www.iana.org/assignments/iana-ipv6-special-registry)
