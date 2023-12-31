# FinetuneDB     Node API Library

[![NPM version](https://img.shields.io/npm/v/finetunedb.svg)](https://npmjs.org/package/finetunedb)

This library wraps TypeScript or Javascript OpenAI API calls and logs additional data to your FinetuneDB account.

It is fully compatible with OpenAI's sdk and logs both streaming and non-streaming requests and responses.


## Installation

```sh
npm install --save finetunedb
# or
yarn add finetunedb
```

## Usage

1. Create a workspace at https://app.finetunedb.com
2. Generate an API key from the workspace settings
3. Find the project ID you want to log to
4. Configure the FinetuneDB client as shown below

```js
// import OpenAI from 'openai'
import OpenAI from "finetunedb/openai";

// Fully compatible with original OpenAI initialization
const openai = new OpenAI({
  apiKey: "your api key", // defaults to process.env["OPENAI_API_KEY"]
  // Optional: Step 1 - Initialize FinetuneDB to enable logging
  finetunedb: {
    apiKey: "your api key", // defaults to process.env["FINETUNEDB_API_KEY"]
  },
});

async function main() {
  // Allows optional finetunedb object
  const completion = await openai.chat.completions.create({
    messages: [{ role: "user", content: "Hello world!" }],
    model: "gpt-3.5-turbo",
    // Optional: Step 2 - Log a chat completion
    finetunedb: {
      // Define the project ID 
      projectId: "cloio7t90000...",
      // Enable/disable data collection. Defaults to true.
      logRequest: true, 
      // Optional: Add custom searchable tags
      tags: ["test-prompt"],
    },
  });

  // Optional: Update log
  await completion.finetunedb.updateLastLog({
    tags: ["test-prompt", "new-tag"]
  })
}

main();
```

## FAQ

### <b>What is the difference between the `apiKey` and the `projectId`?</b>

The `apiKey` is shared across a workspace, and each workspace contains multiple projects with a unique `projectId`.

Imagine your app uses multiple fine-tuned models for specific tasks, each tasks could be defined by a project.

It's good practice to fine-tune task specific models.


### <b>Will OpenAI calls fail if the FinetuneDB client is misconfigured or the platform is down?</b>

Your OpenAI calls will continue to function as expected no matter what. The sdk handles logging errors gracefully without affecting OpenAI inference.