import axios, { AxiosInstance } from 'axios';
import type {
    ChatCompletion,
    ChatCompletionCreateParamsBase,
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { FinetuneDbCompletionArgs } from './shared';

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

    async logCompletion(
        {
            projectId,
            body,
            response,
            latency,
            tags = [],
        }: {
            projectId: string,
            body: (ChatCompletionCreateParamsBase | ChatCompletionCreateParamsNonStreaming | ChatCompletionCreateParamsStreaming) & FinetuneDbCompletionArgs,
            response: ChatCompletion | null,
            latency: number,
            tags?: string[],
        }
    ) {
        if (!this.apiKey) {
            return;
        }

        /*
        
        */

        const request = {
            id: "",
            tags: tags,
            source: "openai-node",
            projectId: projectId,
            modelParameters: {
                provider: "openai",
                model: body.model,
                max_tokens: body.max_tokens,
                temperature: body.temperature,
                top_p: body.top_p,
                stop_sequences: body.stop,
                presence_penalty: body.presence_penalty,
                frequency_penalty: body.frequency_penalty,
            },
            input: body.messages,
            output: response?.choices?.[0].message ? [response.choices[0].message] : [],
            error: "",
            latencyMs: latency,
        }

        const { data } = await this.axiosClient.post('/log', request);
        return data;
    }
}