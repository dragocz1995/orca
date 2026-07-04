export interface InferenceClient {
  /** The model id this client decides with — recorded into audits so a mutation names the model behind it. */
  readonly model: string;
  decide(prompt: string): Promise<{ text: string }>;
}
export interface RelayConfig { baseUrl: string; apiKey: string; model: string }
