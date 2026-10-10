import { ScimProvisioningEvent } from "../../contracts/identity.js";
import { SsoService } from "./sso-service.js";
export declare class ScimService {
    private ssoService;
    private events;
    constructor(ssoService: SsoService);
    handleProvisioningEvent(organizationId: string, action: ScimProvisioningEvent["action"], payload: any): void;
    private processEvent;
    getEvents(organizationId: string): ScimProvisioningEvent[];
}
