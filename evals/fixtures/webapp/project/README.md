# linkboard

A tiny link-sharing board. Node ≥20 built-ins only (`node:http`, `node:test`);
no npm dependencies. Run the suite: `npm test` (= `node --test tests/`).
Tests must each pick a unique port (use port 0 and read the bound address).
