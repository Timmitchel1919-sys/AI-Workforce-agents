import { CustomerProfile, CustomerContact, SuccessPlan } from "../../contracts/customer.js";

export class CustomerService {
  private profiles = new Map<string, CustomerProfile>();
  private contacts = new Map<string, CustomerContact[]>();
  private successPlans = new Map<string, SuccessPlan[]>();

  createProfile(organizationId: string, name: string): CustomerProfile {
    const profile: CustomerProfile = {
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

  getProfile(customerId: string): CustomerProfile | undefined {
    return this.profiles.get(customerId);
  }

  updateHealthScore(customerId: string, score: number) {
    const profile = this.profiles.get(customerId);
    if (!profile) throw new Error("Customer not found");
    profile.healthScore = Math.max(0, Math.min(100, score));
    
    // Automatically flag risk if health is too low
    if (profile.healthScore < 40 && profile.lifecycleStage !== "CHURNED") {
      profile.lifecycleStage = "AT_RISK";
    }
    profile.updatedAt = new Date();
  }

  addContact(contact: Omit<CustomerContact, "contactId">): CustomerContact {
    const newContact: CustomerContact = {
      ...contact,
      contactId: `ct_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    };
    const list = this.contacts.get(contact.customerId) || [];
    list.push(newContact);
    this.contacts.set(contact.customerId, list);
    return newContact;
  }

  getContacts(customerId: string): CustomerContact[] {
    return this.contacts.get(customerId) || [];
  }

  createSuccessPlan(plan: Omit<SuccessPlan, "planId">): SuccessPlan {
    const newPlan: SuccessPlan = {
      ...plan,
      planId: `sp_${Date.now()}_${Math.floor(Math.random() * 1000)}`
    };
    const list = this.successPlans.get(plan.customerId) || [];
    list.push(newPlan);
    this.successPlans.set(plan.customerId, list);
    return newPlan;
  }

  getSuccessPlans(customerId: string): SuccessPlan[] {
    return this.successPlans.get(customerId) || [];
  }
}
