import { beforeEach, describe, expect, it, vi } from "vitest";
import { __testing, ensurePluginRegistryLoaded } from "./plugin-registry.js";

const mocks = vi.hoisted(() => ({
  applyPluginAutoEnable: vi.fn(),
  resolveAgentWorkspaceDir: vi.fn(() => "/tmp/workspace"),
  resolveDefaultAgentId: vi.fn(() => "main"),
  loadConfig: vi.fn(),
  loadOpenClawPlugins: vi.fn(),
  loadPluginManifestRegistry: vi.fn(),
  getActivePluginRegistry: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: mocks.resolveAgentWorkspaceDir,
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../config/plugin-auto-enable.js", () => ({
  applyPluginAutoEnable: mocks.applyPluginAutoEnable,
}));

vi.mock("../plugins/loader.js", () => ({
  loadOpenClawPlugins: mocks.loadOpenClawPlugins,
}));

vi.mock("../plugins/manifest-registry.js", () => ({
  loadPluginManifestRegistry: mocks.loadPluginManifestRegistry,
}));

vi.mock("../plugins/runtime.js", () => ({
  getActivePluginRegistry: mocks.getActivePluginRegistry,
}));

describe("ensurePluginRegistryLoaded", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __testing.resetPluginRegistryLoadedForTests();
    mocks.resolveAgentWorkspaceDir.mockReset().mockReturnValue("/tmp/workspace");
    mocks.resolveDefaultAgentId.mockReset().mockReturnValue("main");
    mocks.loadConfig.mockReset().mockReturnValue({});
    mocks.applyPluginAutoEnable
      .mockReset()
      .mockImplementation(({ config }) => ({ config, changes: [], autoEnabledReasons: {} }));
    mocks.loadOpenClawPlugins.mockReset();
    mocks.loadPluginManifestRegistry.mockReset().mockReturnValue({
      plugins: [],
      diagnostics: [],
    });
    mocks.getActivePluginRegistry.mockReset().mockReturnValue({
      plugins: [],
      channels: [],
      tools: [],
    });
  });

  it("uses the auto-enabled config snapshot for configured channel scope", () => {
    const baseConfig = {
      channels: {
        "demo-chat": {
          botToken: "demo-bot-token",
          appToken: "demo-app-token",
        },
      },
    };
    const autoEnabledConfig = {
      ...baseConfig,
      plugins: {
        entries: {
          "demo-chat": {
            enabled: true,
          },
        },
      },
    };

    mocks.loadConfig.mockReturnValue(baseConfig);
    mocks.applyPluginAutoEnable.mockReturnValue({
      config: autoEnabledConfig,
      changes: [],
      autoEnabledReasons: {
        "demo-chat": ["demo-chat configured"],
      },
    });
    mocks.loadPluginManifestRegistry.mockReturnValue({
      plugins: [{ id: "demo-chat", channels: ["demo-chat"] }],
      diagnostics: [],
    });

    ensurePluginRegistryLoaded({ scope: "configured-channels" });

    expect(mocks.applyPluginAutoEnable).toHaveBeenCalledWith({
      config: baseConfig,
      env: process.env,
    });
    expect(mocks.resolveDefaultAgentId).toHaveBeenCalledWith(autoEnabledConfig);
    expect(mocks.resolveAgentWorkspaceDir).toHaveBeenCalledWith(autoEnabledConfig, "main");
    expect(mocks.loadPluginManifestRegistry).toHaveBeenCalledWith(
      expect.objectContaining({
        config: autoEnabledConfig,
        workspaceDir: "/tmp/workspace",
      }),
    );
    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config: autoEnabledConfig,
        activationSourceConfig: baseConfig,
        autoEnabledReasons: {
          "demo-chat": ["demo-chat configured"],
        },
        onlyPluginIds: ["demo-chat"],
        preferSetupRuntimeForChannelPlugins: true,
        throwOnLoadError: true,
        workspaceDir: "/tmp/workspace",
      }),
    );
  });

  it("reloads when escalating from configured-channels to channels", () => {
    const config = {
      plugins: { enabled: true },
      channels: { "demo-channel-a": { enabled: false } },
    };

    mocks.loadConfig.mockReturnValue(config);
    mocks.applyPluginAutoEnable.mockReturnValue({ config, changes: [], autoEnabledReasons: {} });
    mocks.loadPluginManifestRegistry.mockReturnValue({
      plugins: [
        { id: "demo-channel-a", channels: ["demo-channel-a"] },
        { id: "demo-channel-b", channels: ["demo-channel-b"] },
        { id: "demo-provider", channels: [] },
      ],
      diagnostics: [],
    });
    mocks.getActivePluginRegistry
      .mockReturnValueOnce({
        plugins: [],
        channels: [],
        tools: [],
      })
      .mockReturnValue({
        plugins: [{ id: "demo-channel-a" }],
        channels: [{ plugin: { id: "demo-channel-a" } }],
        tools: [],
      });

    ensurePluginRegistryLoaded({ scope: "configured-channels" });
    ensurePluginRegistryLoaded({ scope: "channels" });

    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledTimes(2);
    expect(mocks.loadOpenClawPlugins).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        activationSourceConfig: config,
        autoEnabledReasons: {},
        onlyPluginIds: [],
        preferSetupRuntimeForChannelPlugins: true,
        throwOnLoadError: true,
      }),
    );
    expect(mocks.loadOpenClawPlugins).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        onlyPluginIds: ["demo-channel-a", "demo-channel-b"],
        throwOnLoadError: true,
      }),
    );
  });

  it("does not treat a pre-seeded partial registry as all scope", () => {
    const config = {
      plugins: { enabled: true },
      channels: { "demo-channel-a": { enabled: true } },
    };

    mocks.loadConfig.mockReturnValue(config);
    mocks.applyPluginAutoEnable.mockReturnValue({ config, changes: [], autoEnabledReasons: {} });
    mocks.getActivePluginRegistry.mockReturnValue({
      plugins: [],
      channels: [{ plugin: { id: "demo-channel-a" } }],
      tools: [],
    });

    ensurePluginRegistryLoaded({ scope: "all" });

    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledTimes(1);
    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        throwOnLoadError: true,
        workspaceDir: "/tmp/workspace",
      }),
    );
  });

  it("does not treat a tools-only pre-seeded registry as channel scope", () => {
    const config = {
      plugins: { enabled: true },
      channels: { "demo-channel-a": { enabled: true } },
    };

    mocks.loadConfig.mockReturnValue(config);
    mocks.applyPluginAutoEnable.mockReturnValue({ config, changes: [], autoEnabledReasons: {} });
    mocks.getActivePluginRegistry.mockReturnValue({
      plugins: [],
      channels: [],
      tools: [{ pluginId: "demo-tool" }],
    });

    ensurePluginRegistryLoaded({ scope: "configured-channels" });

    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledTimes(1);
    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        throwOnLoadError: true,
        workspaceDir: "/tmp/workspace",
      }),
    );
  });

  it("reloads when a pre-seeded channel registry is missing the configured channel plugin ids", () => {
    const config = {
      plugins: { enabled: true },
      channels: {
        "demo-channel-a": {
          botToken: "demo-bot-token",
          appToken: "demo-app-token",
        },
      },
    };

    mocks.loadConfig.mockReturnValue(config);
    mocks.applyPluginAutoEnable.mockReturnValue({ config, changes: [], autoEnabledReasons: {} });
    mocks.loadPluginManifestRegistry.mockReturnValue({
      plugins: [
        { id: "demo-channel-a", channels: ["demo-channel-a"] },
        { id: "demo-channel-b", channels: ["demo-channel-b"] },
      ],
      diagnostics: [],
    });
    mocks.getActivePluginRegistry.mockReturnValue({
      plugins: [{ id: "demo-channel-b" }],
      channels: [{ plugin: { id: "demo-channel-b" } }],
      tools: [],
    });

    ensurePluginRegistryLoaded({ scope: "configured-channels" });

    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledTimes(1);
    expect(mocks.loadOpenClawPlugins).toHaveBeenCalledWith(
      expect.objectContaining({
        config,
        activationSourceConfig: config,
        autoEnabledReasons: {},
        onlyPluginIds: ["demo-channel-a"],
        preferSetupRuntimeForChannelPlugins: true,
        throwOnLoadError: true,
        workspaceDir: "/tmp/workspace",
      }),
    );
  });

  it("does not prefer setup runtime for broader channel scans", () => {
    const config = {
      channels: {
        telegram: { botToken: "telegram-bot-token" },
        slack: { appToken: "slack-app-token" },
      },
    };

    mocks.loadConfig.mockReturnValue(config);
    mocks.applyPluginAutoEnable.mockReturnValue({ config, changes: [], autoEnabledReasons: {} });
    mocks.loadPluginManifestRegistry.mockReturnValue({
      plugins: [
        { id: "telegram", channels: ["telegram"] },
        { id: "slack", channels: ["slack"] },
      ],
      diagnostics: [],
    });

    ensurePluginRegistryLoaded({ scope: "channels" });

    const firstCall = mocks.loadOpenClawPlugins.mock.calls[0]?.[0];
    expect(firstCall).toEqual(
      expect.objectContaining({
        onlyPluginIds: ["telegram", "slack"],
        throwOnLoadError: true,
      }),
    );
    expect(firstCall).not.toHaveProperty("preferSetupRuntimeForChannelPlugins");
  });
});
