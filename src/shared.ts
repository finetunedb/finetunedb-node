import { ChatCompletionMessage, ChatCompletionMessageParam, CompletionChoice, CompletionCreateParams, CreateEmbeddingResponse, Embedding, EmbeddingCreateParams } from "openai/resources";

export type FinetuneDbClientOptions = {
    projectId?: string;
    apiKey?: string;
    baseUrl?: string;
};

export type FinetuneDbCompletionMeta = {
    // We report your call to FinetuneDB asynchronously in the background. If you
    // need to wait until the log is sent to take further action, you can await
    // this promise.
    logResult: Promise<FinetuneDbPostLogResponse | void>;
    getLastLogId: () => Promise<string | undefined>;
    updateLastLog: (update: FinetuneDbPutLogRequest) => Promise<FinetuneDbPutLogResponse | undefined>;
};

export type FinetuneDbCompletionArgs = {
    finetunedb?: {
        logRequest?: boolean
        projectId: string;
        parentId?: string;
        tags?: string[];
        metadata?: Record<string, any>;
    };
}

export type FinetuneDbPutLogResponse = {
    success: boolean;
    message: string;
    data: {
        id: string;
    }
    status: number;
}

export type FinetuneDbPostLogResponse = {
    success: boolean;
    message: string;
    data: {
        id: string;
        type: string;
        createdAt: string;
        updatedAt: string;
    }
    status: number;
}

export type SimpleInput = string | string[] | Record<string, any>;
export type SimpleOutput = string | string[] | Record<string, any>;
export type ModelParameters = {
    model: string;
    provider?: string | null;
    max_tokens?: number | null;
    temperature?: number | null;
    top_p?: number | null;
    stop_sequences?: string[] | null;
    presence_penalty?: number | null;
    frequency_penalty?: number | null;
    other?: Record<string, any> | null;
}

export type FinetuneDbPostLogRequest = {
    id: string;
    projectId: string;
    parentId: string;
    name?: string;
    tags?: string[];
    model: string;
    source: string;
    modelParameters: ModelParameters;
    input: CompletionCreateParams["prompt"] | SimpleInput | ChatCompletionMessageParam[] | EmbeddingCreateParams["input"];
    output: CompletionChoice[] | SimpleOutput | ChatCompletionMessage[] | (CreateEmbeddingResponse["data"]);
    type: (string & {}) | "CHATCOMPLETION" | "COMPLETION" | "TOOL" | "EMBEDDING" | "OTHER";
    metadata: Record<string, any>;
    error?: string;
    latencyMs?: number;
}

export type FinetuneDbPutLogRequest = {
    projectId?: string;
    source?: string;
    modelParameters?: ModelParameters;
    parentId?: string;
    type?: (string & {}) | "CHATCOMPLETION" | "COMPLETION" | "TOOL" | "EMBEDDING" | "OTHER";
    name?: string;
    tags?: string[];
    metadata?: Record<string, any>;
    error?: string;
    latencyMs?: number;
    input?: SimpleInput | ChatCompletionMessageParam[] | EmbeddingCreateParams["input"];
    output?: SimpleOutput | ChatCompletionMessage[] | (CreateEmbeddingResponse["data"]);
}