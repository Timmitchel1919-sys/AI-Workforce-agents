export function deriveCostCenterCapabilities(inputs) {
    return {
        get enforcement() {
            return inputs.providers.list().length > 0;
        },
        get providerIds() {
            return inputs.providers.list();
        },
    };
}
