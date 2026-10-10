export class RatingEngine {
    rateUsage(subscriptionId, usage, price) {
        const charges = [];
        for (const component of price.components) {
            if (component.meterId === usage.meterId) {
                if (component.mode === "USAGE_BASED" || component.mode === "PER_UNIT") {
                    const amount = usage.billableUsage * component.amountMinorUnits;
                    charges.push({
                        subscriptionId,
                        meterId: usage.meterId,
                        description: `Usage charge for ${usage.meterId}`,
                        quantity: usage.billableUsage,
                        unit: "unit", // normally resolved from Meter definition
                        unitPriceMinorUnits: component.amountMinorUnits,
                        amountMinorUnits: amount,
                        currency: component.currency,
                        periodStart: usage.periodStart,
                        periodEnd: usage.periodEnd,
                    });
                }
                else if (component.mode === "TIERED" && component.tierBoundaries) {
                    let remainingUsage = usage.billableUsage;
                    let previousBoundary = 0;
                    for (const tier of component.tierBoundaries) {
                        if (remainingUsage <= 0)
                            break;
                        const tierSize = tier.upTo
                            ? tier.upTo - previousBoundary
                            : Infinity;
                        const usageInTier = Math.min(remainingUsage, tierSize);
                        charges.push({
                            subscriptionId,
                            meterId: usage.meterId,
                            description: `Tiered usage charge for ${usage.meterId} (up to ${tier.upTo || "unlimited"})`,
                            quantity: usageInTier,
                            unit: "unit",
                            unitPriceMinorUnits: tier.amountMinorUnits,
                            amountMinorUnits: usageInTier * tier.amountMinorUnits,
                            currency: component.currency,
                            periodStart: usage.periodStart,
                            periodEnd: usage.periodEnd,
                        });
                        remainingUsage -= usageInTier;
                        previousBoundary = tier.upTo || previousBoundary;
                    }
                }
            }
        }
        return charges;
    }
    rateSubscription(subscriptionId, price, periodStart, periodEnd) {
        const charges = [];
        for (const component of price.components) {
            if (component.mode === "FIXED_RECURRING") {
                charges.push({
                    subscriptionId,
                    description: "Base subscription charge",
                    quantity: 1,
                    unit: "month",
                    unitPriceMinorUnits: component.amountMinorUnits,
                    amountMinorUnits: component.amountMinorUnits,
                    currency: component.currency,
                    periodStart,
                    periodEnd,
                });
            }
        }
        return charges;
    }
}
