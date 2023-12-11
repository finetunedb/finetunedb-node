import type { ChatCompletion, ChatCompletionChunk } from "openai/resources/chat";
import { Stream } from "openai/streaming";
import { FinetuneDbCompletionMeta, FinetuneDbPostLogResponse } from "../shared";
import mergeChunks from "./mergeChunks";

export class WrappedStream extends Stream<ChatCompletionChunk> {
    finetunedb: FinetuneDbCompletionMeta;

    private resolvelogResult: () => void = () => { };
    private report: (response: ChatCompletion | null) => Promise<FinetuneDbPostLogResponse | void>;

    constructor(stream: Stream<ChatCompletionChunk>, report: (response: ChatCompletion | null) => Promise<FinetuneDbPostLogResponse | void>) {
        // @ts-expect-error - This is a private property but we need to access it
        super(stream.iterator, stream.controller);
        this.report = report;

        const logResult = new Promise<void>((resolve) => {
            this.resolvelogResult = resolve;
        });

        this.finetunedb = {
            logResult,
            getLastLogId: async () => {
                return "";
            },
            updateLastLog: async () => {
                return undefined;
            }
        };
    }

    async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk, any, undefined> {
        const iterator = super[Symbol.asyncIterator]();

        let combinedResponse: ChatCompletion | null = null;
        while (true) {
            const result = await iterator.next();
            if (result.done) break;
            combinedResponse = mergeChunks(combinedResponse, result.value);

            yield result.value;
        }

        await this.report(combinedResponse);

        // Resolve the promise here
        this.resolvelogResult();
    }
}