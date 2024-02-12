import { ChatCompletion, ChatCompletionCreateParamsBase, ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from "openai/resources/chat/completions";
import { FinetuneDbCompletionArgs, FinetuneDbIngestResponse, FinetuneDbIngestResponseData, FinetuneDbPostLogRequest, FinetuneDbPostLogResponse, FinetuneDbPutLogRequest, FinetuneDbPutLogResponse, SimpleInput, SimpleOutput } from "./shared";
import { debounce } from "./utils/debounce";
import { createId } from '@paralleldrive/cuid2';
import { CompletionChoice, CompletionCreateParams, CreateEmbeddingResponse, EmbeddingCreateParams } from "openai/resources";

const MAX_CHUNK_SIZE = 20;

export default class FinetuneDbClient {
    apiKey: string;
    baseUrl: string;
    projectId: string;
    logReference: { id: string, createdAt: Date, updatedAt: Date }[] = [];
    private queue: {
        cuid: string,
        type: "create" | "update",
        payload: FinetuneDbPostLogRequest | FinetuneDbPutLogRequest,
        response: FinetuneDbIngestResponseData | null,
        timestamp: Date,
        status: "pending" | "success" | "error",
    }[] = [];
    private queueRunning: boolean = false;

    constructor(
        {
            projectId = '',
            apiKey = '',
            baseUrl = 'https://app.finetunedb.com/api/v1',
        }: {
            projectId: string;
            apiKey?: string;
            baseUrl?: string;
        }) {
        this.projectId = projectId;
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    // Get the finetuneDB log reference
    getLogReferenceById = (id: string) => {
        return this.logReference.find((log) => log.id === id);
    }

    private async postRequest(endpoint: string, requestBody: any) {
        const response = await fetch(this.baseUrl + endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
            body: JSON.stringify(requestBody)
        });
        return response;
    }

    private async getRequest(endpoint: string) {
        const response = await fetch(this.baseUrl + endpoint, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`
            },
        });
        return response;
    }

    private createLog(payload: FinetuneDbPostLogRequest) {
        if (!this.apiKey) {
            return "";
        }

        // Add 1ms to timestamp to keep the order of events
        let timestamp = new Date();
        const lastEvent = this.queue?.[this.queue.length - 1];
        if (lastEvent && lastEvent.timestamp >= timestamp) {
            timestamp = new Date(lastEvent.timestamp.getTime() + 1);
        }

        const request = {
            id: payload.id,
            parentId: payload.parentId,
            name: payload.name,
            tags: payload.tags,
            model: payload.model,
            provider: "openai",
            source: payload.source,
            projectId: payload.projectId,
            modelParameters: payload.modelParameters,
            type: payload.type,
            input: payload.input,
            output: payload.output,
            metadata: payload.metadata,
            error: payload.error,
            latencyMs: payload.latencyMs,
            createdAt: timestamp.toISOString(),
            updatedAt: timestamp.toISOString(),
            inputTokenCount: payload.inputTokenCount ? payload.inputTokenCount : 0,
            outputTokenCount: payload.outputTokenCount ? payload.outputTokenCount : 0,
        }

        this.queue.push({
            cuid: payload.id,
            type: "create",
            payload: request,
            response: null,
            timestamp: timestamp,
            status: "pending",
        });

        // Check if the queue size exceeds the maximum chunk size
        if (this.queue.length > MAX_CHUNK_SIZE) {
            this.processQueue();
        } else {
            this.debouncedProcessQueue();
        }

        const logId = payload.id;
        return logId;
    }

    async updateLog(id: string, payload: FinetuneDbPutLogRequest) {
        if (!this.apiKey) {
            return;
        }

        if (Object.keys(payload).length === 0) {
            return;
        }

        // Add 1ms to timestamp to keep the order of events
        let timestamp = new Date();
        const lastEvent = this.queue?.[this.queue.length - 1];
        if (lastEvent && lastEvent.timestamp >= timestamp) {
            timestamp = new Date(lastEvent.timestamp.getTime() + 1);
        }

        const request = {
            id: id,
            updatedAt: new Date().toISOString(),
            ...payload,
            projectId: payload.projectId ? payload.projectId : this.projectId,
        }

        this.queue.push({
            cuid: id,
            type: "update",
            payload: request,
            response: null,
            timestamp: timestamp,
            status: "pending",
        });

        // Check if the queue size exceeds the maximum chunk size
        if (this.queue.length > MAX_CHUNK_SIZE) {
            this.processQueue();
        } else {
            this.debouncedProcessQueue();
        }

        const logId = id;
        return logId;
    }

    async logOther({
        id,
        projectId,
        parentId,
        name,
        source,
        tags,
        input = "",
        output = "",
        metadata = {},
        error = "",
        latency = 0,
    }: {
        id: string,
        projectId: string,
        parentId: string,
        name: string,
        source?: string,
        tags?: string[],
        input: SimpleInput,
        output: SimpleOutput,
        metadata?: Record<string, any>,
        error?: string,
        latency?: number,
    }) {
        if (!this.apiKey) {
            return;
        }

        const payload = {
            id: id,
            name: name,
            parentId: parentId,
            tags: tags,
            provider: "openai",
            source: source ? source : "node-sdk",
            projectId: projectId,
            model: "",
            modelParameters: {
                model: "",
            },
            type: "OTHER",
            input: input,
            output: output,
            metadata: metadata,
            error: error,
            latencyMs: latency,
        }

        const logId = this.createLog(payload);
        return logId;
    }

    async logCompletion(
        {
            projectId,
            parentId,
            name,
            provider,
            body,
            response,
            inputTokenCount = 0,
            outputTokenCount = 0,
            latency,
            error,
            tags = [],
            metadata = {},
        }: {
            projectId: string,
            parentId: string,
            name: string,
            provider: string,
            body: (CompletionCreateParams) & FinetuneDbCompletionArgs,
            response: CompletionChoice[] | null,
            latency: number,
            inputTokenCount?: number,
            outputTokenCount?: number,
            error?: string,
            tags?: string[],
            metadata?: Record<string, any>,
        }
    ) {
        if (!this.apiKey) {
            return;
        }

        const payload = {
            id: createId(),
            parentId: parentId,
            name: name,
            tags: tags,
            provider: provider,
            source: "openai-node",
            projectId: projectId,
            model: body.model,
            modelParameters: {
                provider: "openai",
                model: body.model,
                max_tokens: body.max_tokens,
                temperature: body.temperature,
                top_p: body.top_p,
                stop_sequences: typeof body.stop === "string" ? [body.stop] : typeof body.stop === "object" ? body.stop : [],
                presence_penalty: body.presence_penalty,
                frequency_penalty: body.frequency_penalty,
            },
            type: "COMPLETION",
            input: body.prompt,
            metadata: metadata,
            output: response ? response.map((choice) => choice.text) : "",
            error: error,
            latencyMs: latency,
            inputTokenCount: inputTokenCount,
            outputTokenCount: outputTokenCount,
        }

        const logId = this.createLog(payload);
        return logId;
    }


    logChatCompletion(
        {
            projectId,
            parentId,
            name = "",
            provider,
            body,
            response,
            latency,
            inputTokenCount = 0,
            outputTokenCount = 0,
            error,
            tags = [],
            metadata = {},
        }: {
            projectId: string,
            parentId: string,
            name: string,
            provider: string,
            body: (ChatCompletionCreateParamsBase | ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming) & FinetuneDbCompletionArgs,
            response: ChatCompletion | null,
            latency: number,
            inputTokenCount?: number,
            outputTokenCount?: number,
            error?: string,
            tags?: string[],
            metadata?: Record<string, any>,
        }
    ) {
        if (!this.apiKey) {
            return "";
        }

        const payload = {
            id: createId(),
            parentId: parentId,
            tags: tags,
            provider: provider,
            source: "node-sdk",
            projectId: projectId ? projectId : this.projectId,
            model: body.model,
            modelParameters: {
                provider: "openai",
                model: body.model,
                max_tokens: body.max_tokens,
                temperature: body.temperature,
                top_p: body.top_p,
                stop_sequences: typeof body.stop === "string" ? [body.stop] : typeof body.stop === "object" ? body.stop : [],
                presence_penalty: body.presence_penalty,
                frequency_penalty: body.frequency_penalty,
            },
            type: "CHATCOMPLETION",
            input: body.messages,
            metadata: metadata,
            output: response?.choices?.[0].message ? [response.choices[0].message] : [],
            error: error,
            latencyMs: latency,
            inputTokenCount: inputTokenCount,
            outputTokenCount: outputTokenCount,
        }

        const logId = this.createLog(payload);
        return logId;
    }

    // Wait 500ms to allow other events to be added to the queue
    private debouncedProcessQueue = debounce(() => this.processQueue(), 500);

    async processQueue() {
        const itemsToProcess = this.queue.filter((event) => event.status === "pending");
        if (!itemsToProcess.length || this.queueRunning) return;

        this.queueRunning = true;

        try {
            const copy = this.queue.filter((event) => event.status === "pending");

            // console.log("FinetuneDB: Sending", copy.length, "event(s) to FinetuneDB");

            const response = await this.postRequest('/ingestBulk', copy.map((event) => { return { type: event.type, payload: event.payload } }));
            const data: FinetuneDbIngestResponse = await response.json();

            if (data.success && data.finished) {
                const failed = data.data.filter((event) => !event.success);
                const success = data.data.filter((event) => event.success);

                if (failed.length > 0) {
                    console.warn("FinetuneDB: Failed to send", failed.length, "event(s) to FinetuneDB");
                    console.warn("FinetuneDB: Failed events", failed);
                }

                for (const event of success) {
                    const index = this.queue.findIndex((item) => item.cuid === event.id && item.status === "pending");
                    if (index !== -1) {
                        this.queue[index].status = "success";
                        this.queue[index].response = event.data;
                    }
                }
                for (const event of failed) {
                    const index = this.queue.findIndex((item) => item.cuid === event.id && item.status === "pending");
                    if (index !== -1) {
                        this.queue[index].status = "error";
                        this.queue[index].response = event.data;
                    }
                }
            } else if (!data.success) {
                console.warn("FinetuneDB: Failed to send event(s) to FinetuneDB");
                this.queueRunning = false;
                return;
            }

            // Clean up the queue
            const completedItems = this.queue.filter((event) => event.status === "success");
            for (const event of completedItems) {
                if (event.response?.id && event.response.createdAt && event.response.updatedAt) {
                    this.logReference.push({
                        id: event.response.id,
                        createdAt: new Date(event.response.createdAt),
                        updatedAt: new Date(event.response.updatedAt)
                    });
                }
            }
            this.queue = this.queue.filter((event) => event.status !== "success" && event.status !== "error");

            this.queueRunning = false;

            const newItemsToProcess = this.queue.filter((event) => event.status === "pending");

            // If there are new events in the queue
            if (newItemsToProcess.length) {
                this.processQueue();
            }

        } catch (error) {
            this.queueRunning = false;
            console.error("Error sending event(s) to FinetuneDB", error);
        }
    }

    logEmbedding(
        {
            projectId,
            parentId,
            body,
            response,
            latency,
            inputTokenCount = 0,
            error = "",
            tags = [],
            metadata = {},
        }: {
            projectId: string,
            parentId: string,
            body: (EmbeddingCreateParams) & FinetuneDbCompletionArgs,
            response: CreateEmbeddingResponse | null,
            latency: number,
            inputTokenCount?: number,
            error?: string,
            tags?: string[],
            metadata?: Record<string, any>,
        }
    ) {
        if (!this.apiKey) {
            return "";
        }

        const payload = {
            id: createId(),
            parentId: parentId,
            tags: tags,
            model: body.model,
            provider: "openai",
            source: "openai-node",
            projectId: projectId ? projectId : this.projectId,
            modelParameters: {
                provider: "openai",
                model: body.model,
            },
            type: "EMBEDDING",
            input: body.input,
            metadata: metadata,
            output: response?.data ? response.data : [],
            error: error,
            latencyMs: latency,
            inputTokenCount: inputTokenCount,
        }

        const logId = this.createLog(payload);
        return logId;
    }

    /**
     * Make sure the queue is flushed before exiting the program
     */
    async flush() {
        await this.processQueue();
    }
}
