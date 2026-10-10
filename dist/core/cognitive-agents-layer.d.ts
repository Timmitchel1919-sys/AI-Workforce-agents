export declare class CognitiveAgentsLayer {
    initDeveloperAgent(): Promise<void>;
    initQAAgent(): Promise<void>;
    initProductAgent(): Promise<void>;
    initControlPlaneAgent(): Promise<void>;
    routeTaskToAgent(taskType: string): Promise<{
        status: string;
    }>;
    runLayerInitialization(): Promise<void>;
}
