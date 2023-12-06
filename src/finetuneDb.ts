import axios, { AxiosInstance } from 'axios';
import type {
    ChatCompletion,
    ChatCompletionCreateParamsBase,
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { FinetuneDbCompletionArgs, FinetuneDbPostLogRequest, FinetuneDbPostLogResponse } from './shared';
import { CreateEmbeddingResponse, EmbeddingCreateParams } from 'openai/resources';

export default class FinetuneDbClient {
    apiKey: string;
    baseUrl: string;
    axiosClient: AxiosInstance;
    constructor(
        {
            apiKey = '',
            baseUrl = 'https://app.finetunedb.com/api/v1',
        }: {
            apiKey?: string;
            baseUrl?: string;
        }) {

        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.axiosClient = axios.create({
            baseURL: baseUrl,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
        });
    }

    async createLog(payload: FinetuneDbPostLogRequest) {
        if (!this.apiKey) {
            return;
        }

        const request = {
            id: payload.id,
            parentId: payload.parentId,
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
        }

        try {
            const { data }: { data: FinetuneDbPostLogResponse } = await this.axiosClient.post('/log', request);
            return data;
        }
        catch (error) {
            console.warn("FinetuneDB: Unable to create log.");
        }
    }

    async logChatCompletion(
        {
            projectId,
            parentId,
            body,
            response,
            latency,
            error,
            tags = [],
            metadata = {},
        }: {
            projectId: string,
            parentId: string,
            body: (ChatCompletionCreateParamsBase | ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming) & FinetuneDbCompletionArgs,
            response: ChatCompletion | null,
            latency: number,
            error?: string,
            tags?: string[],
            metadata?: Record<string, any>,
        }
    ) {
        if (!this.apiKey) {
            return;
        }

        const payload = {
            id: "",
            parentId: parentId,
            tags: tags,
            provider: "openai",
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
            input: body.messages,
            metadata: metadata,
            output: response?.choices?.[0].message ? [response.choices[0].message] : [],
            error: error,
            latencyMs: latency,
        }

        const data = await this.createLog(payload);

        if (data?.success) {
            return data;
        } else {
            console.warn("FinetuneDB: Unable to log completion.", data?.message);
        }

        return data;
    }

    async logEmbedding(
        {
            projectId,
            parentId,
            body,
            response,
            latency,
            error = "",
            tags = [],
            metadata = {},
        }: {
            projectId: string,
            parentId: string,
            body: (EmbeddingCreateParams) & FinetuneDbCompletionArgs,
            response: CreateEmbeddingResponse | null,
            latency: number,
            error?: string,
            tags?: string[],
            metadata?: Record<string, any>,
        }
    ) {
        if (!this.apiKey) {
            return;
        }

        const payload = {
            id: "",
            parentId: parentId,
            tags: tags,
            model: body.model,
            provider: "openai",
            source: "openai-node",
            projectId: projectId,
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
        }

        const data = await this.createLog(payload);

        if (data?.success) {
            return data;
        } else {
            console.warn("FinetuneDB: Unable to log completion.", data?.message);
        }

        return data;
    }
}