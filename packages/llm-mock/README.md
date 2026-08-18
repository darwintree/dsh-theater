# dsh-llm-mock

Deterministic, keyless LLM adapter for DSH end-to-end and automation tests.

```yaml
- id: mock-llm
  name: '@darwintree/dsh-llm-mock'
  config:
    provider: mock
    model: scripted
    script:
      - content:
          - type: text
            text: Hello from the mock model.
```

Linear scripts select their response by the number of assistant messages in the request. Import `MockLlmAdapter` with a custom `Behaviour` when a test needs branching.
