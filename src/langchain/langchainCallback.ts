import { BaseCallbackHandler, NewTokenIndices } from "langchain/callbacks";
import FinetuneDbClient from "../finetuneDb";
import type { Serialized } from "langchain/load/serializable";
import { AIMessage, BaseMessage, ChainValues, HumanMessage, LLMResult, SystemMessage } from "langchain/schema";
import { type Document } from "langchain/document";
import { FinetuneDbPostLogResponse } from "../shared";
import { ChatCompletionMessageParam } from "openai/resources";
import { HandleLLMNewTokenCallbackFields } from "langchain/dist/callbacks/base";
import { createId } from "@paralleldrive/cuid2";

export class FinetuneDbCallbackHandler extends BaseCallbackHandler {
    name = "FinetuneDbCallbackHandler";
    finetuneDbClient?: FinetuneDbClient
    projectId?: string;

    logId?: string;
    groupId?: string;
    topLevelGroupId?: string;
    rootGroupId?: string;

    runIdToLogId: Record<string, string>;
    runIdToLog: Record<string, FinetuneDbPostLogResponse>;

    constructor(params: {
        finetunedb: FinetuneDbClient;
    }) {
        super();
        this.projectId = params.finetunedb.projectId;
        this.runIdToLogId = {};
        this.runIdToLog = {};
        this.finetuneDbClient = params.finetunedb;
    }


    private async generateGroup(
        chain: Serialized,
        runId: string,
        parentRunId: string | undefined,
        inputs: ChainValues,
        tags?: string[] | undefined,
        metadata?: Record<string, unknown> | undefined
    ): Promise<boolean> {
        let groupCreated = false;
        if (!this.logId) {
            const newLogId = await this.finetuneDbClient?.logOther({
                id: createId(),
                projectId: this.projectId ?? "",
                parentId: parentRunId ? this.runIdToLogId[parentRunId] : this.topLevelGroupId ? this.runIdToLogId[this.topLevelGroupId] : "",
                name: chain && chain.id ? chain.id.join(".") : "",
                tags: tags ? tags : [],
                input: inputs,
                output: "",
                source: "langchain",
                metadata: {
                    ...metadata,
                    runId: runId,
                    parentRunId: parentRunId,
                },
                error: "",
                latency: 0,
            });
            if (newLogId) {
                this.logId = newLogId;
                this.runIdToLogId[runId] = this.logId;
                groupCreated = true;
            }
        }
        this.topLevelGroupId = parentRunId ? this.runIdToLogId[parentRunId] : this.runIdToLogId[runId];
        return groupCreated;
    }

    private async generateLog(
        chain: Serialized,
        runId: string,
        inputs: ChainValues | string,
        parentRunId?: string | undefined,
        tags?: string[] | undefined,
        metadata?: Record<string, unknown> | undefined
    ) {
        const newLogId = await this.finetuneDbClient?.logOther({
            id: createId(),
            projectId: this.projectId ?? "",
            parentId: parentRunId ? this.runIdToLogId[parentRunId] : this.topLevelGroupId ? this.runIdToLogId[this.topLevelGroupId] : this.runIdToLogId[runId],
            name: chain && chain.id ? chain.id.join(".") : "",
            tags: tags ? tags : [],
            input: inputs,
            output: "",
            source: "langchain",
            metadata: {
                ...metadata,
                runId: runId,
                parentRunId: parentRunId,
            },
            error: "",
            latency: 0,
        });
        if (newLogId) {
            this.logId = newLogId;
            this.runIdToLogId[runId] = this.logId;
        }
    }

    private async handleChatGenerationStart(
        llm: Serialized,
        messages: BaseMessage[][],
        runId: string,
        parentRunId?: string | undefined,
        extraParams?: Record<string, unknown> | undefined,
        tags?: string[] | undefined,
        metadata?: Record<string, unknown> | undefined
    ): Promise<void> {
        const modelParameters: Record<string, any> = {};
        const invocationParams = extraParams?.["invocation_params"];

        for (const [key, value] of Object.entries({
            model: (invocationParams as any)?.model,
            temperature: (invocationParams as any)?.temperature,
            max_tokens: (invocationParams as any)?.max_tokens,
            top_p: (invocationParams as any)?.top_p,
            frequency_penalty: (invocationParams as any)?.frequency_penalty,
            presence_penalty: (invocationParams as any)?.presence_penalty,
            n: (invocationParams as any)?.n,
            best_of: (invocationParams as any)?.best_of,
            logit_bias: (invocationParams as any)?.logit_bias,
            stop: (invocationParams as any)?.stop,
            user: (invocationParams as any)?.user,
            stream: (invocationParams as any)?.stream,
            request_timeout: (invocationParams as any)?.request_timeout,
        })) {
            if (value !== undefined && value !== null) {
                modelParameters[key] = value;
            }
        }

        interface InvocationParams {
            _type?: string;
            model?: string;
            model_name?: string;
            repo_id?: string;
        }

        let extractedModelName: string | undefined;
        if (extraParams) {
            const params = extraParams.invocation_params as InvocationParams;
            extractedModelName = params.model;
        }

        // Format langchain messages to Openai standard
        const formattedMessages = [] as Array<ChatCompletionMessageParam>;

        if (messages && messages[0]) {
            messages[0].forEach((message) => {
                if (message.constructor.name === "SystemMessage") {
                    formattedMessages.push({
                        role: "system",
                        content: message.content ? message.content as string : "",
                    });
                }
                else if (message.constructor.name === "AIMessage") {
                    if (message.additional_kwargs?.function_call) {
                        formattedMessages.push({
                            role: "assistant",
                            tool_calls: [{
                                id: "",
                                function: {
                                    arguments: message.additional_kwargs?.function_call.arguments,
                                    name: message.additional_kwargs?.function_call.name
                                },
                                type: "function"
                            }],
                            content: message.content ? message.content as string : "",
                        });
                    } else {
                        formattedMessages.push({
                            role: "assistant",
                            content: message.content ? message.content as string : "",
                        });
                    }
                }
                else if (message.constructor.name === "HumanMessage") {
                    formattedMessages.push({
                        role: "user",
                        content: message.content ? message.content as string : "",
                    });
                }
                else if (message.constructor.name === "FunctionMessage") {
                    formattedMessages.push({
                        role: "tool",
                        content: message.content ? message.content as string : "",
                        tool_call_id: message.name ? message.name as string : "",
                    });
                }
            });
        }

        if (this.finetuneDbClient) {
            const newLogId = await this.finetuneDbClient.logChatCompletion({
                projectId: this.projectId ?? "",
                parentId: parentRunId ? this.runIdToLogId[parentRunId] : this.topLevelGroupId ? this.runIdToLogId[this.topLevelGroupId] : "",
                name: llm && llm.id ? llm.id.join(".") : "",
                provider: extraParams?.["provider"] as string ?? "",
                body: {
                    model: extractedModelName ?? "",
                    max_tokens: modelParameters.max_tokens ? modelParameters.max_tokens : undefined,
                    temperature: modelParameters.temperature ? modelParameters.temperature : undefined,
                    top_p: modelParameters.top_p ? modelParameters.top_p : undefined,
                    stop: modelParameters.stop ? modelParameters.stop : undefined,
                    presence_penalty: modelParameters.presence_penalty ? modelParameters.presence_penalty : undefined,
                    frequency_penalty: modelParameters.frequency_penalty ? modelParameters.frequency_penalty : undefined,
                    stream: modelParameters.stream ? modelParameters.stream : undefined,
                    messages: formattedMessages as Array<ChatCompletionMessageParam>
                },
                response: null,
                latency: 0,
                metadata: {
                    ...metadata,
                    runId: runId,
                    parentRunId: parentRunId,
                },
                tags: tags ? tags : [],
            });

            if (newLogId) {
                this.logId = newLogId;
                this.runIdToLogId[runId] = this.logId;
            }
        }

    }

    private async handleGenerationStart(
        llm: Serialized,
        messages: BaseMessage[][] | string[],
        runId: string,
        parentRunId?: string | undefined,
        extraParams?: Record<string, unknown> | undefined,
        tags?: string[] | undefined,
        metadata?: Record<string, unknown> | undefined
    ): Promise<void> {
        const modelParameters: Record<string, any> = {};
        const invocationParams = extraParams?.["invocation_params"];

        for (const [key, value] of Object.entries({
            model: (invocationParams as any)?.model,
            temperature: (invocationParams as any)?.temperature,
            max_tokens: (invocationParams as any)?.max_tokens,
            top_p: (invocationParams as any)?.top_p,
            frequency_penalty: (invocationParams as any)?.frequency_penalty,
            presence_penalty: (invocationParams as any)?.presence_penalty,
            n: (invocationParams as any)?.n,
            best_of: (invocationParams as any)?.best_of,
            logit_bias: (invocationParams as any)?.logit_bias,
            stop: (invocationParams as any)?.stop,
            user: (invocationParams as any)?.user,
            stream: (invocationParams as any)?.stream,
            request_timeout: (invocationParams as any)?.request_timeout,
        })) {
            if (value !== undefined && value !== null) {
                modelParameters[key] = value;
            }
        }

        interface InvocationParams {
            _type?: string;
            model?: string;
            model_name?: string;
            repo_id?: string;
        }

        let extractedModelName: string | undefined;
        if (extraParams) {
            const params = extraParams.invocation_params as InvocationParams;
            extractedModelName = params.model;
        }

        if (this.finetuneDbClient) {
            const newLogId = await this.finetuneDbClient.logCompletion({
                projectId: this.projectId ?? "",
                parentId: parentRunId ? this.runIdToLogId[parentRunId] : this.topLevelGroupId ? this.runIdToLogId[this.topLevelGroupId] : "",
                name: llm && llm.id ? llm.id.join(".") : "",
                provider: extraParams?.["provider"] as string ?? "",
                body: {
                    model: extractedModelName ?? "",
                    max_tokens: modelParameters.max_tokens ? modelParameters.max_tokens : undefined,
                    temperature: modelParameters.temperature ? modelParameters.temperature : undefined,
                    top_p: modelParameters.top_p ? modelParameters.top_p : undefined,
                    stop: modelParameters.stop ? modelParameters.stop : undefined,
                    presence_penalty: modelParameters.presence_penalty ? modelParameters.presence_penalty : undefined,
                    frequency_penalty: modelParameters.frequency_penalty ? modelParameters.frequency_penalty : undefined,
                    stream: modelParameters.stream ? modelParameters.stream : undefined,
                    prompt: typeof messages === "string" ? messages : messages.join(""),
                },
                response: null,
                latency: 0,
                metadata: {
                    ...metadata,
                    runId: runId,
                    parentRunId: parentRunId,
                },
                tags: tags ? tags : [],
            });

            if (newLogId) {
                this.logId = newLogId;
                this.runIdToLogId[runId] = this.logId;
            }
        }

    }

    async handleChainStart(
        chain: Serialized,
        inputs: ChainValues,
        runId: string,
        parentRunId?: string | undefined,
        tags?: string[] | undefined,
        metadata?: Record<string, unknown> | undefined
    ): Promise<void> {
        try {
            const groupCreated = await this.generateGroup(chain, runId, parentRunId, inputs, tags, metadata);
            if (groupCreated) {
                // await this.generateLog(chain, runId, inputs, runId, tags, metadata);
            } else {
                await this.generateLog(chain, runId, inputs, parentRunId, tags, metadata);
            }
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleChainEnd(outputs: ChainValues, runId: string, parentRunId?: string | undefined): Promise<void> {
        try {
            const log = this.runIdToLog[runId];

            let latency = 0;
            const logCreationTime = this.finetuneDbClient?.getLogReferenceById(this.runIdToLogId[runId])?.createdAt;
            if (logCreationTime) {
                latency = Date.now() - new Date(logCreationTime).getTime();
            }

            await this.finetuneDbClient?.updateLog(this.runIdToLogId[runId], {
                projectId: this.projectId ?? "",
                source: "langchain",
                parentId: parentRunId ? this.runIdToLogId[parentRunId] : undefined,
                output: outputs,
                latencyMs: latency,
            });
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleChainError(error: Error, runId: string, parentRunId?: string | undefined): Promise<void> {
        // We wait becaue we want to make sure the log is sent before we update it.
        setTimeout(async () => {
            let latency = 0;
            const logCreationTime = this.finetuneDbClient?.getLogReferenceById(this.runIdToLogId[runId])?.createdAt;
            if (logCreationTime) {
                latency = Date.now() - new Date(logCreationTime).getTime();
            }

            try {
                await this.finetuneDbClient?.updateLog(this.runIdToLogId[runId], {
                    projectId: this.projectId ?? "",
                    source: "langchain",
                    error: error.message,
                    latencyMs: latency,
                });
            } catch (e) {
                console.log("Error:", e);
            }
        }, 1500);
    }


    async handleChatModelStart(llm: Serialized, messages: BaseMessage[][], runId: string, parentRunId?: string | undefined, extraParams?: Record<string, unknown> | undefined, tags?: string[] | undefined, metadata?: Record<string, unknown> | undefined, name?: string | undefined) {
        try {
            const provider = llm.id[2] ? llm.id[2].toString() : "";
            if (extraParams === undefined) {
                extraParams = {};
                extraParams["provider"] = provider;
            } else {
                extraParams["provider"] = provider;
            }
            this.handleChatGenerationStart(llm, messages, runId, parentRunId, extraParams, tags, metadata);
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleLLMStart(
        llm: Serialized,
        prompts: string[],
        runId: string,
        parentRunId?: string | undefined,
        extraParams?: Record<string, unknown> | undefined,
        tags?: string[] | undefined,
        metadata?: Record<string, unknown> | undefined
    ): Promise<void> {
        try {
            const provider = llm.id[2] ? llm.id[2].toString() : "";
            if (extraParams === undefined) {
                extraParams = {};
                extraParams["provider"] = provider;
            } else {
                extraParams["provider"] = provider;
            }
            this.handleGenerationStart(llm, prompts, runId, parentRunId, extraParams, tags, metadata);
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleLLMEnd(output: LLMResult, runId: string, parentRunId?: string | undefined): Promise<void> {
        try {
            const lastResponse =
                output.generations[output.generations.length - 1][output.generations[output.generations.length - 1].length - 1];

            let finalOutput = "" as string | ChatCompletionMessageParam[];
            let type;

            if ("message" in lastResponse) {

                const message = lastResponse["message"] as AIMessage | SystemMessage | HumanMessage;
                type = "CHATCOMPLETION"
                if (lastResponse["generationInfo"]?.finish_reason === "function_call") {
                    finalOutput = [{
                        role: "assistant",
                        tool_calls: [{
                            id: "",
                            function: {
                                arguments: message.additional_kwargs?.function_call?.arguments ?? "",
                                name: message.additional_kwargs?.function_call?.name ?? ""
                            },
                            type: "function"
                        }],
                        content: message.content ? message.content as string : "",
                    }]
                } else {
                    finalOutput = [{
                        role: "assistant",
                        content: lastResponse.text,
                    }]
                }
            } else {
                type = "COMPLETION"
                finalOutput = lastResponse.text;
            }

            if (this.finetuneDbClient) {

                let latency = 0;
                const logCreationTime = this.finetuneDbClient?.getLogReferenceById(this.runIdToLogId[runId])?.createdAt;
                if (logCreationTime) {
                    latency = Date.now() - new Date(logCreationTime).getTime();
                }

                const result = await this.finetuneDbClient?.updateLog(this.runIdToLogId[runId], {
                    projectId: this.projectId ?? "",
                    source: "langchain",
                    parentId: parentRunId ? this.runIdToLogId[parentRunId] : undefined,
                    output: finalOutput,
                    latencyMs: latency,
                    inputTokenCount: output.llmOutput?.tokenUsage?.promptTokens,
                    outputTokenCount: output.llmOutput?.tokenUsage?.completionTokens,
                });
            }
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleLLMNewToken(token: string, idx: NewTokenIndices, runId: string, parentRunId?: string | undefined, tags?: string[] | undefined, fields?: HandleLLMNewTokenCallbackFields | undefined) {

    }

    async handleToolStart(tool: Serialized, input: string, runId: string, parentRunId?: string | undefined, tags?: string[] | undefined, metadata?: Record<string, unknown> | undefined, name?: string | undefined) {
        try {
            await this.generateLog(tool, runId, input, parentRunId, tags, metadata);
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleToolEnd(output: string, runId: string, parentRunId?: string | undefined): Promise<void> {
        try {
            let latency = 0;
            const logCreationTime = this.finetuneDbClient?.getLogReferenceById(this.runIdToLogId[runId])?.createdAt;
            if (logCreationTime) {
                latency = Date.now() - new Date(logCreationTime).getTime();
            }

            const result = await this.finetuneDbClient?.updateLog(this.runIdToLogId[runId], {
                projectId: this.projectId ?? "",
                source: "langchain",
                parentId: parentRunId ? this.runIdToLogId[parentRunId] : undefined,
                output: output,
                latencyMs: latency,
            });
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleLLMError(error: Error, runId: string, parentRunId?: string | undefined): Promise<void> {
        // We wait becaue we want to make sure the log is sent before we update it.
        setTimeout(async () => {
            try {
                let log = this.runIdToLog[runId];

                let latency = 0;
                const logCreationTime = this.finetuneDbClient?.getLogReferenceById(this.runIdToLogId[runId])?.createdAt;
                if (logCreationTime) {
                    latency = Date.now() - new Date(logCreationTime).getTime();
                }

                const result = await this.finetuneDbClient?.updateLog(this.runIdToLogId[runId], {
                    projectId: this.projectId ?? "",
                    source: "langchain",
                    error: error.message,
                    parentId: parentRunId ? this.runIdToLogId[parentRunId] : undefined,
                    type: log.data.type,
                    latencyMs: latency,
                });
            } catch (e) {
                console.log("Error:", e);
            }
        }, 1500);
    }

    async handleRetrieverStart(
        retriever: Serialized,
        query: string,
        runId: string,
        parentRunId?: string | undefined,
        tags?: string[] | undefined,
        metadata?: Record<string, unknown> | undefined
    ): Promise<void> {
        try {
            await this.generateLog(retriever, runId, query, parentRunId, tags, metadata);
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleRetrieverEnd(
        documents: Document<Record<string, any>>[],
        runId: string,
        parentRunId?: string | undefined
    ): Promise<void> {
        try {
            let latency = 0;
            const logCreationTime = this.finetuneDbClient?.getLogReferenceById(this.runIdToLogId[runId])?.createdAt;
            if (logCreationTime) {
                latency = Date.now() - new Date(logCreationTime).getTime();
            }

            const result = await this.finetuneDbClient?.updateLog(this.runIdToLogId[runId], {
                projectId: this.projectId ?? "",
                source: "langchain",
                parentId: parentRunId ? this.runIdToLogId[parentRunId] : undefined,
                output: documents,
                latencyMs: latency,
            });
        } catch (e) {
            console.log("Error:", e);
        }
    }

    async handleRetrieverError(error: Error, runId: string, parentRunId?: string | undefined): Promise<void> {
        // We wait becaue we want to make sure the log is sent before we update it.
        setTimeout(async () => {
            try {
                let latency = 0;
                const logCreationTime = this.finetuneDbClient?.getLogReferenceById(this.runIdToLogId[runId])?.createdAt;
                if (logCreationTime) {
                    latency = Date.now() - new Date(logCreationTime).getTime();
                }

                const result = await this.finetuneDbClient?.updateLog(this.runIdToLogId[runId], {
                    projectId: this.projectId ?? "",
                    source: "langchain",
                    error: error.message,
                    latencyMs: latency
                });
            } catch (e) {
                console.log("Error:", e);
            }
        }, 1500);
    }


}
