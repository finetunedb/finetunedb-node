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
    logResult: Promise<void>;
};

export type FinetuneDbCompletionArgs = {
    finetunedb?: {
        logRequest?: boolean
        projectId: string;
        tags?: string[];
    };
}