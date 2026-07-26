# Crawler provenance

This service was copied from `crawler-service/` in the private IgnitionRAG
repository at commit:

`5ee939ea14dc781c9d02de1da98a936e3c00769a`

The imported crawler had 33 passing Python tests. Ignition Outbound owns this
copy from this point forward; there is no runtime dependency or automatic
synchronisation with IgnitionRAG.

Outbound-specific changes include self-hosted SearXNG search, local trace correlation,
stricter production authentication, bounded crawl limits, robots.txt handling,
request interception, and normalized evidence metadata.
