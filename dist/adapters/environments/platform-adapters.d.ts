/**
 * EO-4.5 platform execution adapters. This is the ONLY place that knows
 * platform facts (Xcode needs macOS, Android needs JDK + Android SDK, Unity
 * modules, Unreal compilers, container daemons). Every decision is taken
 * from authoritative EO-2 discovery metadata — never from display names
 * ("Visual Studio PC") and never from a request.
 *
 * IDE ≠ TOOLCHAIN: there is no Visual Studio / VS Code / Android Studio
 * adapter. Projects edited in an IDE route to the family of the underlying
 * toolchain (.NET SDK / MSBuild, Node, JDK + Gradle + Android SDK, Xcode).
 *
 * Adapters evaluate; they never execute. Runners execute.
 */
import { type ContainerPolicy, type EnvironmentExecutionAdapter } from "../../contracts/index.js";
/** Windows: .NET SDK / MSBuild / Node / Windows packaging (no cmd, no PowerShell). */
export declare function createWindowsAdapter(): EnvironmentExecutionAdapter;
/** macOS: Xcode / Swift / Apple SDKs. Apple targets need discovered SDKs. */
export declare function createMacosXcodeAdapter(): EnvironmentExecutionAdapter;
/** Android: JDK + Gradle + Android SDK are all required. */
export declare function createAndroidAdapter(): EnvironmentExecutionAdapter;
/** Linux: backend/web/CLI builds (no unrestricted Bash). */
export declare function createLinuxAdapter(): EnvironmentExecutionAdapter;
/**
 * Docker: descriptor exists ≠ executable present ≠ daemon operational ≠
 * container execution authorized. Every workload passes the container
 * policy (no privileged, host network/PID, socket, devices, host mounts).
 */
export declare function createDockerAdapter(policy: ContainerPolicy): EnvironmentExecutionAdapter;
/**
 * Provider-neutral cloud runner contract: provision/lease, verify identity
 * (registry), prepare workspace, run bounded operations, collect declared
 * artifacts, terminate. Bound to no vendor.
 */
export declare function createCloudRunnerAdapter(executables?: readonly string[]): EnvironmentExecutionAdapter;
/** Unity: exact editor version + discovered build modules, batch mode only. */
export declare function createUnityAdapter(): EnvironmentExecutionAdapter;
/** Unreal: exact engine version + C++ compiler + target platform SDKs. */
export declare function createUnrealAdapter(): EnvironmentExecutionAdapter;
/** Every platform adapter (contracts). Runners are registered separately. */
export declare function createPlatformAdapters(options: {
    containerPolicy: ContainerPolicy;
    cloudExecutables?: readonly string[];
}): EnvironmentExecutionAdapter[];
