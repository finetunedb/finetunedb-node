import type {
    ChatCompletion,
    ChatCompletionCreateParamsBase,
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { FinetuneDbCompletionArgs, FinetuneDbPostLogRequest, FinetuneDbPostLogResponse, FinetuneDbPutLogRequest, SimpleInput, SimpleOutput } from './shared';
import { Completion, CompletionChoice, CompletionCreateParams, CreateEmbeddingResponse, EmbeddingCreateParams } from 'openai/resources';

export default class FinetuneDbClient {
    apiKey: string;
    baseUrl: string;
    projectId: string;
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

    private async createLog(payload: FinetuneDbPostLogRequest) {
        if (!this.apiKey) {
            return;
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
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }

        try {
            const response = await this.postRequest('/logs', request);
            const data: FinetuneDbPostLogResponse = await response.json();
            return data;
        }
        catch (error) {
            console.warn("FinetuneDB: Unable to create log.");
        }
    }

    async updateLog(id: string, payload: FinetuneDbPutLogRequest) {
        if (!this.apiKey) {
            return;
        }

        if (Object.keys(payload).length === 0) {
            return;
        }


        const request = {
            id: id,
            updatedAt: new Date().toISOString(),
            ...payload,
            projectId: payload.projectId ? payload.projectId : this.projectId,
        }

        try {
            const response = await this.postRequest('/log/' + id, request);
            const data: FinetuneDbPostLogResponse = await response.json();
            return data;
        }
        catch (error) {
            console.warn("FinetuneDB: Unable to update log.");
        }
    }

    async logOther({
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
            id: "",
            name: name,
            parentId: parentId,
            tags: tags,
            provider: "openai",
            source: source ? source : "openai-node",
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

        try {
            const data = await this.createLog(payload);

            if (data?.success) {
                return data;
            } else {
                console.warn("FinetuneDB: Unable to log completion.", data?.message);
            }
        }
        catch (error) {
            console.warn("FinetuneDB: Unable to log completion.");
        }
    }

    async logCompletion(
        {
            projectId,
            parentId,
            name,
            provider,
            body,
            response,
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
        }

        const data = await this.createLog(payload);

        if (data?.success) {
            return data;
        } else {
            console.warn("FinetuneDB: Unable to log completion.", data?.message);
        }

        return data;
    }

    async logChatCompletion(
        {
            projectId,
            parentId,
            name = "",
            provider,
            body,
            response,
            latency,
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
            provider: provider,
            source: "openai-node",
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