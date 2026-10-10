import type { Repository } from "../../contracts/persistence.js";
import type { OperatorPrincipal } from "../../contracts/control.js";
import { ValidationError } from "../../contracts/index.js";
import type {
  ProductPortfolio,
  ProductDefinition,
  CustomerProblem,
  ProductOpportunity,
  ProductFeature,
} from "../../contracts/product.js";

export class ProductManagementService {
  constructor(
    private readonly portfolios: Repository<ProductPortfolio>,
    private readonly products: Repository<ProductDefinition>,
    private readonly problems: Repository<CustomerProblem>,
    private readonly opportunities: Repository<ProductOpportunity>,
    private readonly features: Repository<ProductFeature>
  ) {}

  private enforceAdmin(operator: OperatorPrincipal) {
    if (operator.role !== "admin") {
      throw new ValidationError("Unauthorized. Requires admin role for Product operations.");
    }
  }

  async listProducts(): Promise<ProductDefinition[]> {
    return this.products.list();
  }

  async listProblems(): Promise<CustomerProblem[]> {
    return this.problems.list();
  }

  async listFeatures(): Promise<ProductFeature[]> {
    return this.features.list();
  }
}
