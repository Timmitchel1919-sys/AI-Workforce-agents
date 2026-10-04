import { ValidationError } from "../../contracts/index.js";
export class ProductManagementService {
    portfolios;
    products;
    problems;
    opportunities;
    features;
    constructor(portfolios, products, problems, opportunities, features) {
        this.portfolios = portfolios;
        this.products = products;
        this.problems = problems;
        this.opportunities = opportunities;
        this.features = features;
    }
    enforceAdmin(operator) {
        if (operator.role !== "admin") {
            throw new ValidationError("Unauthorized. Requires admin role for Product operations.");
        }
    }
    async listProducts() {
        return this.products.list();
    }
    async listProblems() {
        return this.problems.list();
    }
    async listFeatures() {
        return this.features.list();
    }
}
