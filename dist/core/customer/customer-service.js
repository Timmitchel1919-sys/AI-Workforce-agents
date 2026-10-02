export class CustomerService {
    profiles = new Map();
    contacts = new Map();
    successPlans = new Map();
    createProfile(organizationId, name) {
        const profile = {
            customerId: `cust_${organizationId}`,
            organizationId,
            name,
            lifecycleStage: "ONBOARDING",
            healthScore: 100, // Starts fully healthy
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.profiles.set(profile.customerId, profile);
        return profile;
    }
    getProfile(customerId) {
        return this.profiles.get(customerId);
    }
    updateHealthScore(customerId, score) {
        const profile = this.profiles.get(customerId);
        if (!profile)
            throw new Error("Customer not found");
        profile.healthScore = Math.max(0, Math.min(100, score));
        // Automatically flag risk if health is too low
        if (profile.healthScore < 40 && profile.lifecycleStage !== "CHURNED") {
            profile.lifecycleStage = "AT_RISK";
        }
        profile.updatedAt = new Date();
    }
    addContact(contact) {
        const newContact = {
            ...contact,
            contactId: `ct_${Date.now()}_${Math.floor(Math.random() * 1000)}`
        };
        const list = this.contacts.get(contact.customerId) || [];
        list.push(newContact);
        this.contacts.set(contact.customerId, list);
        return newContact;
    }
    getContacts(customerId) {
        return this.contacts.get(customerId) || [];
    }
    createSuccessPlan(plan) {
        const newPlan = {
            ...plan,
            planId: `sp_${Date.now()}_${Math.floor(Math.random() * 1000)}`
        };
        const list = this.successPlans.get(plan.customerId) || [];
        list.push(newPlan);
        this.successPlans.set(plan.customerId, list);
        return newPlan;
    }
    getSuccessPlans(customerId) {
        return this.successPlans.get(customerId) || [];
    }
}
