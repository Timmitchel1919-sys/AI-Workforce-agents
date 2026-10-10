import type { Repository } from "../../contracts/persistence.js";
import type { ProductPortfolio, ProductDefinition, CustomerProblem, ProductOpportunity, ProductFeature } from "../../contracts/product.js";
export declare class ProductManagementService {
    private readonly portfolios;
    private readonly products;
    private readonly problems;
    private readonly opportunities;
    private readonly features;
    constructor(portfolios: Repository<ProductPortfolio>, products: Repository<ProductDefinition>, problems: Repository<CustomerProblem>, opportunities: Repository<ProductOpportunity>, features: Repository<ProductFeature>);
    private enforceAdmin;
    listProducts(): Promise<ProductDefinition[]>;
    listProblems(): Promise<CustomerProblem[]>;
    listFeatures(): Promise<ProductFeature[]>;
}
