# @agentscript/memory

Embedding, vector storage, semantic recall, and working memory for AgentScript
agents. **Offline by default** — a `HashEmbedder` + in-process
`MemoryVectorStore` need no API key — and every seam is an interface, so you can
swap in a live embedder or an external vector store for production without
touching callers.

## Install

```bash
pnpm add @agentscript/memory
```

## Two kinds of memory

- **Semantic memory** (`SemanticMemory`) — long-term recall. `remember()` embeds
  a message/fact and stores it; `recall()` embeds a query and returns the
  nearest entries, scoped to a thread or resource.
- **Working memory** (`WorkingMemory`) — a small, always-in-prompt scratchpad
  (the agent's "notepad"), truncated to a char budget so it never blows up the
  context window.

## Semantic recall

```typescript
import { SemanticMemory, HashEmbedder } from '@agentscript/memory';

const memory = new SemanticMemory({
  embedder: new HashEmbedder(), // offline; swap for a live Embedder
  // store defaults to an in-process MemoryVectorStore
});

await memory.remember({
  id: 'm1',
  text: 'The customer prefers email over phone.',
  threadId: 'thread-42',
  resourceId: 'user-7',
  role: 'user',
});

const hits = await memory.recall('how should I contact them?', {
  resourceId: 'user-7', // recall across all of this user's threads
  topK: 3,
  minScore: 0.1,
});
// hits: RecallHit[] — each entry plus a similarity `score`
```

Scoping (`threadId` / `resourceId`) is enforced through the vector store's
metadata filter, so one thread's memories never leak into an unrelated thread's
recall.

## Working memory

```typescript
import { WorkingMemory } from '@agentscript/memory';

const wm = new WorkingMemory({ maxChars: 2000 });
const ref = { threadId: 'thread-42' }; // or { resourceId: 'user-7' }

await wm.write(ref, 'Goal: book a refund for order ORD-9.');
await wm.append(ref, 'Confirmed order id with the user.');
const notes = await wm.read(ref); // inject into the system prompt
```

The scope is derived from the `ref` (`resource:<id>` if present, else
`thread:<id>`); content past `maxChars` is truncated (oldest tail dropped) so
the notepad never blows the prompt budget.

## Swapping the backends

| Seam                 | Default (offline)                      | Swap for                                                                        |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| `Embedder`           | `HashEmbedder` (deterministic, no API) | `FunctionEmbedder({ dimensions, model, embedMany })` wrapping any embedding API |
| `VectorStore`        | `MemoryVectorStore` (in-process)       | a pgvector / Pinecone / Qdrant adapter implementing `VectorStore`               |
| `WorkingMemoryStore` | `MemoryWorkingMemoryStore`             | a Redis/DB-backed store implementing `WorkingMemoryStore`                       |

```typescript
import { FunctionEmbedder } from '@agentscript/memory';

const embedder = new FunctionEmbedder({
  dimensions: 1536,
  model: 'my-model',
  embedMany: async texts => await myEmbeddingApi(texts), // returns number[][]
});
```

## Composition

`@sf-agentscript/rag` builds its retrieval pipeline on this package's `Embedder`

- `VectorStore`. Recalled entries can be fed into a `beforeLlmStep` middleware to
  inject relevant memories into each step.

## Verify offline

```bash
pnpm --filter @agentscript/memory test    # unit tests
pnpm --filter @agentscript/memory smoke    # offline end-to-end, no API key
```

## License

Apache-2.0. See [LICENSE.txt](../../LICENSE.txt).
