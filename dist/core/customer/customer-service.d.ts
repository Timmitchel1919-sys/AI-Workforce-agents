import { CustomerProfile, CustomerContact, SuccessPlan } from "../../contracts/customer.js";
export declare class CustomerService {
    private profiles;
    private contacts;
    private successPlans;
    createProfile(organizationId: string, name: string): CustomerProfile;
    getProfile(customerId: string): CustomerProfile | undefined;
    updateHealthScore(customerId: string, score: number): void;
    addContact(contact: Omit<CustomerContact, "contactId">): CustomerContact;
    getContacts(customerId: string): CustomerContact[];
    createSuccessPlan(plan: Omit<SuccessPlan, "planId">): SuccessPlan;
    getSuccessPlans(customerId: string): SuccessPlan[];
}
