import { ChatCompletionMessage, ChatCompletionMessageParam, CreateEmbeddingResponse, Embedding, EmbeddingCreateParams } from "openai/resources";

export type FinetuneDbClientOptions = {
    apiKey?: string;
    baseUrl?: string;
};


export type FinetuneDbLogResponse = {
    success: boolean;
    message: string;
    data: {
        id: string;
    } | null;
    status: number;
};

export type FinetuneDbCompletionMeta = {
    // We report your call to FinetuneDB asynchronously in the background. If you
    // need to wait until the log is sent to take further action, you can await
    // this promise.
    logResult: Promise<FinetuneDbPostLogResponse | void>;
    getLastLogId: () => Promise<string | undefined>;
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

export type FinetuneDbPostLogResponse = {
    success: boolean;
    message: string;
    data: {
        id: string;
    }
    status: number;
}

export type FinetuneDbPostLogRequest = {
    id: string;
    projectId: string;
    parentId: string;
    tags?: string[];
    model: string;
    source: string;
    modelParameters: {
        model: string;
        provider?: string | null;
        max_tokens?: number | null;
        temperature?: number | null;
        top_p?: number | null;
        stop_sequences?: string[] | null;
        presence_penalty?: number | null;
        frequency_penalty?: number | null;
        other?: Record<string, any> | null;
    };
    input: (ChatCompletionMessageParam[]) | (EmbeddingCreateParams["input"]);
    output: ChatCompletionMessage[] | (CreateEmbeddingResponse["data"]);
    type: (string & {}) | "COMPLETION" | "TOOL" | "EMBEDDING" | "OTHER";
    metadata: Record<string, any>;
    error?: string;
    latencyMs?: number;
}