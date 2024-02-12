import * as openai from "openai";
import * as Core from "openai/core";
import { readEnv } from "openai/core";
import type { Stream } from "openai/streaming";
import type {
    ChatCompletion,
    ChatCompletionChunk,
    ChatCompletionCreateParams,
    ChatCompletionCreateParamsBase,
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { FinetuneDbCompletionArgs, type FinetuneDbClientOptions, FinetuneDbCompletionMeta } from "./shared";
import { WrappedStream } from "./openai/streaming";
import FinetuneDbClient from "./finetuneDb";
import { CreateEmbeddingResponse, EmbeddingCreateParams, Embeddings } from "openai/resources";


export type ClientOptions = openai.ClientOptions & { finetunedb?: FinetuneDbClientOptions };

export default class OpenAI extends openai.OpenAI {
    public finetuneDbClient?: FinetuneDbClient

    constructor({ finetunedb, ...options }: ClientOptions = {}) {
        super({ ...options });

        const finetuneDbApiKey = finetunedb?.apiKey ?? readEnv("FINETUNEDB_API_KEY");
        const finetuneDbBaseUrl = finetunedb?.baseUrl;
        const finetuneDbProjectId = finetunedb?.projectId ?? readEnv("FINETUNEDB_PROJECT_ID");

        if (finetuneDbApiKey && finetuneDbBaseUrl) {
            const client = new FinetuneDbClient({
                projectId: finetuneDbProjectId ?? "",
                apiKey: finetuneDbApiKey,
                baseUrl: finetuneDbBaseUrl,
            });
            this.chat.setClient(client);
            this.embeddings.setClient(client);
        } else {
            console.warn(
                "You're using the FinetuneDB client without an API key. No completion requests will be logged.",
            );
        }
    }

    // Override the default completion method to log requests to FinetuneDB
    chat: WrappedChat = new WrappedChat(this);
    embeddings: WrappedEmbeddings = new WrappedEmbeddings(this);
}

class WrappedChat extends openai.OpenAI.Chat {
    setClient(client: FinetuneDbClient) {
        this.completions.finetuneDbClient = client;
    }

    completions: WrappedCompletions = new WrappedCompletions(this._client);
}

class WrappedCompletions extends openai.OpenAI.Chat.Completions {
    // keep a reference to the original client so we can read options from it
    openaiClient: openai.OpenAI;
    finetuneDbClient?: FinetuneDbClient;

    constructor(client: openai.OpenAI, finetuneDbClient?: FinetuneDbClient) {
        super(client);
        this.openaiClient = client;
        this.finetuneDbClient = finetuneDbClient;
    }

    private _report(
        {
            projectId,
            parentId,
            body,
            response,
            latency,
            inputTokenCount = 0,
            outputTokenCount = 0,
            tags = [],
            error = "",
            metadata = {},
        }: {
            projectId?: string,
            parentId?: string,
            body: (ChatCompletionCreateParamsBase | ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming) & FinetuneDbCompletionArgs,
            response: ChatCompletion | null,
            latency: number,
            inputTokenCount?: number,
            outputTokenCount?: number,
            tags?: string[],
            error?: string,
            metadata?: Record<string, any>,
        }
    ) {
        try {
            if (this.finetuneDbClient) {
                return this.finetuneDbClient.logChatCompletion({
                    projectId: projectId ? projectId : this.finetuneDbClient.projectId,
                    parentId: parentId ?? "",
                    name: "",
                    provider: "openai",
                    body,
                    response,
                    inputTokenCount,
                    outputTokenCount,
                    error,
                    latency,
                    tags,
                    metadata,
                })
            }
            return "";
        } catch (e) {
            // Ignore errors with reporting
            return "";
        }
    }

    _create(
        body: ChatCompletionCreateParamsNonStreaming,
        options?: Core.RequestOptions,
    ): Core.APIPromise<ChatCompletion>;
    _create(
        body: ChatCompletionCreateParamsStreaming,
        options?: Core.RequestOptions,
    ): Core.APIPromise<Stream<ChatCompletionChunk>>;
    _create(
        body: ChatCompletionCreateParams,
        options?: Core.RequestOptions,
    ): Core.APIPromise<ChatCompletion | Stream<ChatCompletionChunk>> {
        let resp: Core.APIPromise<ChatCompletion | Stream<ChatCompletionChunk>>;
        resp = body.stream ? super.create(body, options) : super.create(body, options);
        return resp;
    }

    // @ts-expect-error Type mismatch because a `Promise<>` is being used.
    // wrapper but I actually think the types are correct here.
    create(
        body: ChatCompletionCreateParamsNonStreaming & FinetuneDbCompletionArgs,
        options?: Core.RequestOptions,
    ): Core.APIPromise<ChatCompletion & { finetunedb: FinetuneDbCompletionMeta }>;
    create(
        body: ChatCompletionCreateParamsStreaming & FinetuneDbCompletionArgs,
        options?: Core.RequestOptions,
    ): Core.APIPromise<WrappedStream>;
    create(
        body: ChatCompletionCreateParamsBase & FinetuneDbCompletionArgs,
        options?: Core.RequestOptions,
    ): Core.APIPromise<Stream<ChatCompletionChunk> | ChatCompletion>;
    async create(
        { finetunedb: rawFinetunedb, ...body }: ChatCompletionCreateParams & FinetuneDbCompletionArgs,
        options?: Core.RequestOptions,
    ): Promise<Core.APIPromise<(ChatCompletion & { finetunedb: FinetuneDbCompletionMeta }) | WrappedStream>> {
        const finetunedb = {
            logRequest: true,
            ...rawFinetunedb
        };
        const startTime = Date.now();
        let logId: FinetuneDbCompletionMeta["logId"] = "";

        try {
            if (body.stream) {
                const stream = await this._create(body, options);
                try {
                    return new WrappedStream(stream, (response) => {
                        if (!finetunedb.projectId && !(this.finetuneDbClient && this.finetuneDbClient.projectId)) {
                            console.warn(
                                "You're using the FinetuneDB client without a project ID. No completion requests will be logged.",
                            );
                            return "";
                        }
                        if (!finetunedb.logRequest) return "";
                        return this._report({
                            projectId: finetunedb.projectId ? finetunedb.projectId : this.finetuneDbClient?.projectId ?? "",
                            parentId: finetunedb.parentId,
                            body: body,
                            response: response,
                            latency: Date.now() - startTime,
                            inputTokenCount: response?.usage?.prompt_tokens ?? 0,
                            outputTokenCount: response?.usage?.completion_tokens ?? 0,
                            tags: finetunedb.tags,
                            metadata: finetunedb.metadata,
                        });
                    });
                } catch (e) {
                    console.error("FinetuneDB: error creating wrapped stream");
                    console.error(e);
                    throw e;
                }
            } else {
                const response = await this._create(body, options);

                if (!finetunedb.projectId && !(this.finetuneDbClient && this.finetuneDbClient.projectId)) {
                    console.warn(
                        "You're using the FinetuneDB client without a project ID. No completion requests will be logged.",
                    );
                }

                logId = finetunedb.logRequest && (finetunedb.projectId || this.finetuneDbClient?.projectId)
                    ? this._report({
                        projectId: finetunedb.projectId ? finetunedb.projectId : this.finetuneDbClient?.projectId ?? "",
                        parentId: finetunedb.parentId,
                        body: body,
                        response: response,
                        latency: Date.now() - startTime,
                        inputTokenCount: response?.usage?.prompt_tokens ?? 0,
                        outputTokenCount: response?.usage?.completion_tokens ?? 0,
                        tags: finetunedb.tags,
                        metadata: finetunedb.metadata,
                    })
                    : "";

                return {
                    ...response,
                    finetunedb: {
                        logId,
                        getLastLogId: () => {
                            return logId;
                        },
                        updateLastLog: async (update) => {
                            if (logId) {
                                return await this.finetuneDbClient?.updateLog(logId, {
                                    ...update,
                                    projectId: finetunedb.projectId ? finetunedb.projectId : this.finetuneDbClient?.projectId ?? "",
                                });
                            }
                            return undefined;
                        }
                    },
                };
            }
        } catch (error: unknown) {
            if (error instanceof openai.APIError) {
                const rawMessage = error.message as string | string[];
                const message = Array.isArray(rawMessage) ? rawMessage.join(", ") : rawMessage;
                if (!finetunedb.projectId && !(this.finetuneDbClient && this.finetuneDbClient.projectId)) {
                    console.warn(
                        "You're using the FinetuneDB client without a project ID. No completion requests will be logged.",
                    );
                }
                else {
                    logId = this._report({
                        projectId: finetunedb.projectId ? finetunedb.projectId : this.finetuneDbClient?.projectId ?? "",
                        parentId: finetunedb.parentId,
                        body: body,
                        response: null,
                        latency: Date.now() - startTime,
                        inputTokenCount: 0,
                        outputTokenCount: 0,
                        tags: finetunedb.tags,
                        error: message,
                        metadata: finetunedb.metadata,
                    });
                }
            }

            // make sure error is an object we can add properties to
            if (typeof error === "object" && error !== null) {
                error = {
                    ...error,
                    finetunedb: {
                        logId,
                    },
                };
            }

            throw error;
        }
    }
}

class WrappedEmbeddings extends openai.OpenAI.Embeddings {
    // keep a reference to the original client so we can read options from it
    client: openai.OpenAI;
    finetuneDbClient?: FinetuneDbClient;

    constructor(client: openai.OpenAI, finetuneDbClient?: FinetuneDbClient) {
        super(client);
        this.client = client;
        this.finetuneDbClient = finetuneDbClient;
    }

    setClient(client: FinetuneDbClient) {
        this.finetuneDbClient = client;
    }

    private _report(

        {
            projectId,
            parentId,
            body,
            response,
            latency,
            error = "",
            inputTokenCount = 0,
            outputTokenCount = 0,
            tags = [],
            metadata = {},
        }: {
            projectId?: string,
            parentId?: string,
            body: EmbeddingCreateParams & FinetuneDbCompletionArgs,
            response: CreateEmbeddingResponse | null,
            latency: number,
            error?: string,
            inputTokenCount?: number,
            outputTokenCount?: number,
            tags?: string[],
            metadata?: Record<string, any>,
        }
    ) {
        try {
            if (this.finetuneDbClient) {
                return this.finetuneDbClient.logEmbedding({
                    projectId: projectId ? projectId : this.finetuneDbClient.projectId,
                    parentId: parentId ?? "",
                    body,
                    response,
                    latency,
                    inputTokenCount,
                    tags,
                    metadata,
                })
            }
            return "";
        } catch (e) {
            // Ignore errors with reporting
            return "";
        }
    }

    private _create(
        body: EmbeddingCreateParams,
        options?: Core.RequestOptions,
    ): Core.APIPromise<CreateEmbeddingResponse> {
        let resp: Core.APIPromise<CreateEmbeddingResponse>;
        resp = super.create(body, options);
        return resp;
    }

    // @ts-expect-error Type mismatch because a `Promise<>` is being used.
    // wrapper but I actually think the types are correct here.
    create(
        body: EmbeddingCreateParams & FinetuneDbCompletionArgs,
        options?: Core.RequestOptions,
    ): Core.APIPromise<CreateEmbeddingResponse & { finetunedb: FinetuneDbCompletionMeta }>;
    async create(
        { finetunedb: rawFinetunedb, ...body }: EmbeddingCreateParams & FinetuneDbCompletionArgs,
        options?: Core.RequestOptions,
    ): Promise<Core.APIPromise<CreateEmbeddingResponse & { finetunedb: FinetuneDbCompletionMeta }>> {
        const finetunedb = {
            logRequest: true,
            ...rawFinetunedb
        };
        const startTime = Date.now();
        let logId: FinetuneDbCompletionMeta["logId"] = "";

        try {
            const response = await this._create(body, options);

            if (!finetunedb.projectId && !(this.finetuneDbClient && this.finetuneDbClient.projectId)) {
                console.warn(
                    "You're using the FinetuneDB client without a project ID. No completion requests will be logged.",
                );
            }

            logId = finetunedb.logRequest && (finetunedb.projectId || this.finetuneDbClient?.projectId)
                ? this._report({
                    projectId: finetunedb.projectId ? finetunedb.projectId : this.finetuneDbClient?.projectId ?? "",
                    parentId: finetunedb.parentId,
                    body: body,
                    response: response,
                    latency: Date.now() - startTime,
                    tags: finetunedb.tags,
                    error: "",
                    inputTokenCount: response.usage.prompt_tokens,
                    metadata: finetunedb.metadata,
                })
                : "";

            return {
                ...response,
                finetunedb: {
                    logId,
                    getLastLogId: () => {
                        if (logId) {
                            return logId;
                        }
                        return "";
                    },
                    updateLastLog: async (update) => {
                        if (logId) {
                            return await this.finetuneDbClient?.updateLog(logId, {
                                ...update,
                                projectId: finetunedb.projectId ? finetunedb.projectId : this.finetuneDbClient?.projectId ?? "",
                            });
                        }
                        return undefined;
                    }
                },
            };
        } catch (error: unknown) {
            if (error instanceof openai.APIError) {
                const rawMessage = error.message as string | string[];
                const message = Array.isArray(rawMessage) ? rawMessage.join(", ") : rawMessage;
                if (!finetunedb.projectId && !(this.finetuneDbClient && this.finetuneDbClient.projectId)) {
                    console.warn(
                        "You're using the FinetuneDB client without a project ID. No completion requests will be logged.",
                    );
                }
                else {
                    logId = this._report({
                        projectId: finetunedb.projectId ? finetunedb.projectId : this.finetuneDbClient?.projectId ?? "",
                        parentId: finetunedb.parentId,
                        body: body,
                        response: null,
                        latency: Date.now() - startTime,
                        inputTokenCount: 0,
                        error: message,
                        tags: finetunedb.tags,
                        metadata: finetunedb.metadata,
                    });
                }
            }

            // make sure error is an object we can add properties to
            if (typeof error === "object" && error !== null) {
                error = {
                    ...error,
                    finetunedb: {
                        logId,
                    },
                };
            }

            throw error;
        }
    }
}