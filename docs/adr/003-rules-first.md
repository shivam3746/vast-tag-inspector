# ADR 003 — Rules first, LLM second

The inspection engine runs deterministic VAST rules and persists their findings. The default provider supplies curated fixes for each rule. Operators can enable a local Ollama model or Gemini 3.1 Flash-Lite on a Free Tier project to generate a summary and next steps from the same evidence.

The provider sees allowlisted rule identifiers, fixed descriptions, and bounded severity counts. The prompt omits raw XML, tag URLs, and creative text. A strict schema and exact rule-ID checks validate output before any write, including one fix per supplied rule. Suggested fixes name what to change and, where possible, how to verify it.

Cache entries are scoped by team and keyed by canonical evidence, model, and prompt version. The API limits requests by user and only writers can request a new explanation. Team viewers can read a saved explanation.

The evaluation measures rules against labeled fixtures and reports explanation validation, agreement, latency, and API cost where known. Model metrics come from an explicit Ollama or Gemini run.

This keeps inspection findings reproducible and provides guidance when a model account is unavailable. The reduced evidence limits explanations to general rule guidance, and generated fixes still require human review. Gemini failures fall back to the built-in provider with its own visible label.
