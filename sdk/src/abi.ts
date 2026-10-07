/** Minimal ABI fragments mirroring `contracts/src`. */

export const aiAgentRegistryAbi = [
  "function registerAgent(bytes32 agentPubKey, bytes memory zkHardwareProof) returns (address agent)",
  "function revokeAgent(address agent)",
  "function agentAddress(bytes32 agentPubKey) view returns (address agent)",
  "function isAuthorizedAgent(address agent) view returns (bool authorized)",
  "function requireAuthorizedAgent(address agent) view returns (address owner)",
  "function agentByKey(bytes32 agentPubKey) view returns (address agent)",
  "event AgentRegistered(address indexed agent, address indexed owner, bytes32 agentPubKey, bytes32 hardwareId)",
  "event AgentRevoked(address indexed agent, address indexed owner)",
] as const;

export const humanTokenAbi = [
  "function claimHumanQuota(bytes memory zkProof) returns (uint256 minted)",
  "function balanceOf(address account) view returns (uint256 balance)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function HUMAN_QUOTA() view returns (uint256)",
  "function MAX_GLOBAL_SUPPLY() view returns (uint256)",
  "event HumanQuotaClaimed(address indexed wallet, address indexed agent, bytes32 indexed personhoodId, uint256 amount)",
] as const;

export const maoTangFactoryAbi = [
  "function createMemeToken(string name, string symbol) returns (address token, address curve)",
  "event MemeTokenCreated(address indexed token, address indexed curve, address indexed creator, string name, string symbol)",
] as const;

export const maoTangCurveAbi = [
  "function buyTokensOnCurve() payable returns (uint256 tokensOut)",
  "function sellTokensOnCurve() returns (uint256 amountOut)",
  "function calculatePrice() view returns (uint256 price)",
  "function token() view returns (address token)",
  "function target() view returns (uint256 target)",
  "event TokenPurchased(address indexed buyer, uint256 reserveIn, uint256 tokensOut, uint256 newPrice)",
  "event TokenSold(address indexed seller, uint256 tokensIn, uint256 reserveOut, uint256 newPrice)",
  "event FeeRouted(address indexed asset, uint256 amount, uint8 source)",
] as const;

export const maoTangGraduateAbi = [
  "function graduateToMarket() returns (address market)",
  "function graduationProgressBps() view returns (uint256 progressBps)",
  "event TokenGraduated(address indexed curve, address indexed market, uint256 reserveMigrated, uint256 tokensMigrated)",
] as const;
