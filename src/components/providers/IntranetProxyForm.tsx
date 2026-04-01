import { useState, useEffect, useMemo, useImperativeHandle, forwardRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RefreshCw, Link2, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { settingsApi } from "@/lib/api/settings";
import type { IntranetProxyConfig } from "@/types";
import ApiKeyInput from "@/components/providers/forms/ApiKeyInput";
import EndpointSpeedTest from "@/components/providers/forms/EndpointSpeedTest";
import type { EndpointCandidate } from "@/types";

/** 暴露给外部调用的方法 */
export interface IntranetProxyFormRef {
  /** 触发保存，返回 Promise（外部可 await 后再关闭面板） */
  save: () => Promise<void>;
  /** 当前是否正在保存 */
  isSaving: boolean;
}

const LOCALSTORAGE_KEY = "cc_switch_intranet_proxy_config";

const DEFAULT_CONFIG: IntranetProxyConfig = {
  enabled: false,
  apiKey: "",
  baseUrl: "",
  modelMapping: {
    smallModel: "",
    model: "",
    opusModel: "",
  },
  searchApiKey: "",
};

/**
 * 判断当前是否运行在 Tauri 环境（非 H5/浏览器预览模式）。
 * Tauri v2 会在 window 上注入 __TAURI_INTERNALS__ 对象。
 */
function isTauriEnv(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

/**
 * 从 localStorage 读取内网代理配置（H5 降级方案）
 */
function readFromLocalStorage(): IntranetProxyConfig {
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<IntranetProxyConfig>) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * 将内网代理配置写入 localStorage（H5 降级方案）
 */
function writeToLocalStorage(config: IntranetProxyConfig): void {
  try {
    localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

/**
 * 内网代理配置表单（嵌入版）
 * 从 IntranetProxyCard 提取，用于在新增/编辑 Provider 对话框的"内网配置" Tab 内复用。
 * 读取 settings.intranetProxy 并预填充，开关状态变更立即保存，其余字段通过"保存配置"按钮保存。
 *
 * 兼容性：
 *   - Tauri 环境：通过 settingsApi.get() / settingsApi.saveIntranetProxyConfig() 读写后端配置
 *   - H5/浏览器环境：通过 localStorage 降级读写（key: cc_switch_intranet_proxy_config）
 *
 * 保存副作用（仅 Tauri 环境，点击"保存配置"时触发）：
 *   - 启用内网代理 → 清除 ~/.claude/settings.json 中的外网 ANTHROPIC_* 环境变量
 */
export const IntranetProxyForm = forwardRef<IntranetProxyFormRef>(function IntranetProxyForm(_props, ref) {
  const queryClient = useQueryClient();
  const tauri = isTauriEnv();

  // Tauri 环境：通过 react-query 读取 settings
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
    // H5 环境下不发起查询，避免 invoke 报错
    enabled: tauri,
  });

  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [smallModel, setSmallModel] = useState("");
  const [model, setModel] = useState("");
  const [opusModel, setOpusModel] = useState("");
  const [searchApiKey, setSearchApiKey] = useState("");

  // 端点测速弹窗状态
  const [showSpeedTest, setShowSpeedTest] = useState(false);
  // 完整 URL 开关状态
  const [isFullUrl, setIsFullUrl] = useState(false);
  // 自动选择最优端点
  const [autoSelect, setAutoSelect] = useState(false);

  // H5 环境：组件挂载时从 localStorage 一次性读取并反写
  useEffect(() => {
    if (tauri) return; // Tauri 环境走下面的 settings useEffect
    const proxy = readFromLocalStorage();
    setEnabled(proxy.enabled ?? false);
    setApiKey(proxy.apiKey ?? "");
    setBaseUrl(proxy.baseUrl ?? "");
    setSmallModel(proxy.modelMapping?.smallModel ?? "");
    setModel(proxy.modelMapping?.model ?? "");
    setOpusModel(proxy.modelMapping?.opusModel ?? "");
    setSearchApiKey(proxy.searchApiKey ?? "");
    // tauri 不会变化，只需在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tauri 环境：从 settings 中初始化表单值（优先读取当前配置反向填入）
  useEffect(() => {
    if (!tauri || !settings) return;
    const proxy = settings.intranetProxy ?? DEFAULT_CONFIG;
    setEnabled(proxy.enabled ?? false);
    setApiKey(proxy.apiKey ?? "");
    setBaseUrl(proxy.baseUrl ?? "");
    setSmallModel(proxy.modelMapping?.smallModel ?? "");
    setModel(proxy.modelMapping?.model ?? "");
    setOpusModel(proxy.modelMapping?.opusModel ?? "");
    setSearchApiKey(proxy.searchApiKey ?? "");
  }, [tauri, settings]);

  // 端点测速的初始候选列表：仅包含当前 baseUrl
  const speedTestEndpoints = useMemo<EndpointCandidate[]>(() => {
    if (!baseUrl) return [];
    return [{ url: baseUrl.trim().replace(/\/+$/, ""), isCustom: false }];
  }, [baseUrl]);

  const saveMutation = useMutation({
    mutationFn: async (config: IntranetProxyConfig) => {
      if (tauri) {
        // 1. 保存内网代理配置
        await settingsApi.saveIntranetProxyConfig(config);
        // 2. 根据启用状态执行文件副作用
        if (config.enabled) {
          // 启用内网：清除外网 env 配置（忽略错误，不阻断主流程）
          await settingsApi.clearClaudeSettingsEnv().catch((e: unknown) => {
            console.warn("clearClaudeSettingsEnv failed:", e);
          });
        }
        return;
      }
      // H5 降级：写入 localStorage
      writeToLocalStorage(config);
    },
    onSuccess: () => {
      if (tauri) {
        queryClient.invalidateQueries({ queryKey: ["settings"] });
      }
      toast.success("内网代理配置已保存");
    },
    onError: (error: Error) => {
      toast.error(`保存失败: ${error.message}`);
    },
  });

  // 从 config.json 同步配置到表单及 settings.json
  const syncMutation = useMutation({
    mutationFn: async () => settingsApi.syncIntranetProxyFromFile(),
    onSuccess: (config: IntranetProxyConfig) => {
      setEnabled(config.enabled ?? false);
      setApiKey(config.apiKey ?? "");
      setBaseUrl(config.baseUrl ?? "");
      setSmallModel(config.modelMapping?.smallModel ?? "");
      setModel(config.modelMapping?.model ?? "");
      setOpusModel(config.modelMapping?.opusModel ?? "");
      setSearchApiKey(config.searchApiKey ?? "");
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("已从 config.json 同步配置");
    },
    onError: (error: Error) => {
      toast.error(`同步失败: ${error.message}`);
    },
  });

  // 切换开关仅更新本地 state，不触发持久化
  // 实际保存在用户点击"保存配置"按钮时统一进行
  const handleToggle = (value: boolean) => {
    setEnabled(value);
  };

  // 提交表单（返回 Promise 以便外部 await）
  const handleSave = (): Promise<void> => {
    const config: IntranetProxyConfig = {
      enabled,
      apiKey,
      baseUrl,
      modelMapping: { smallModel, model, opusModel },
      // searchApiKey 为空时默认使用 apiKey
      searchApiKey: searchApiKey || apiKey,
    };
    return new Promise<void>((resolve, reject) => {
      saveMutation.mutate(config, {
        onSuccess: () => resolve(),
        onError: (error) => reject(error),
      });
    });
  };

  // 暴露 save 方法给外部通过 ref 调用
  useImperativeHandle(ref, () => ({
    save: handleSave,
    isSaving: saveMutation.isPending,
  }));

  return (
    <div className="space-y-4">
      {/* 开关行 */}
      <div className="flex items-center justify-between gap-4 py-1">
        <div className="space-y-1">
          <p className="text-sm font-medium leading-none">启用内网代理</p>
          <p className="text-xs text-muted-foreground">
            配置内网 Claude Code Proxy 连接参数
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          aria-label="是否开启内网代理配置"
        />
      </div>

      {/* 配置字段（始终显示，无论是否启用） */}
      <div className="space-y-4">
        {/* API Key — 使用带小眼睛的 ApiKeyInput */}
        <ApiKeyInput
          id="intranet-api-key-form"
          label="API Key"
          value={apiKey}
          onChange={setApiKey}
          placeholder="输入供应商 API Key"
        />

        {/* Base URL — 内联实现（EndpointField 依赖 FormContext，不可在此复用） */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="intranet-base-url-form" className="text-sm font-medium">
                Base URL
              </Label>
              <div className="flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1">
                <Link2 className={`h-3.5 w-3.5 ${isFullUrl ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`text-xs font-medium ${isFullUrl ? "text-foreground" : "text-muted-foreground"}`}>
                  完整 URL
                </span>
                <Switch
                  checked={isFullUrl}
                  onCheckedChange={setIsFullUrl}
                  aria-label="完整 URL"
                  className="h-5 w-9"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSpeedTest(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Zap className="h-3.5 w-3.5" />
              管理和测速
            </button>
          </div>
          <Input
            id="intranet-base-url-form"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="例如：https://your-proxy.internal/v1"
            autoComplete="off"
          />
        </div>

        {/* 端点测速弹窗 */}
        {showSpeedTest && (
          <EndpointSpeedTest
            appId="claude"
            value={baseUrl}
            onChange={setBaseUrl}
            initialEndpoints={speedTestEndpoints}
            visible={showSpeedTest}
            onClose={() => setShowSpeedTest(false)}
            autoSelect={autoSelect}
            onAutoSelectChange={setAutoSelect}
          />
        )}

        {/* Model Mapping */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            模型映射（Model Mapping）
          </p>
          <div className="space-y-2 pl-2">
            <div className="space-y-1.5">
              <Label htmlFor="intranet-small-model-form" className="text-xs">
                small_model
              </Label>
              <Input
                id="intranet-small-model-form"
                value={smallModel}
                onChange={(e) => setSmallModel(e.target.value)}
                placeholder="小型模型名称"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intranet-model-form" className="text-xs">
                model
              </Label>
              <Input
                id="intranet-model-form"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="默认模型名称"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intranet-opus-model-form" className="text-xs">
                opus_model
              </Label>
              <Input
                id="intranet-opus-model-form"
                value={opusModel}
                onChange={(e) => setOpusModel(e.target.value)}
                placeholder="高级模型名称"
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Search API Key — 使用带小眼睛的 ApiKeyInput */}
        <ApiKeyInput
          id="intranet-search-api-key-form"
          label="Search API Key（留空则使用 API Key）"
          value={searchApiKey}
          onChange={setSearchApiKey}
          placeholder="安全验证密钥，默认同 API Key"
        />

        {/* 同步按钮（仅 Tauri 环境） */}
        {tauri && (
          <div className="flex justify-start items-center pt-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
              title="从 ~/.config/claude-code-proxy/config.json 读取并同步到此表单"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              {syncMutation.isPending ? "同步中..." : "同步 config.json"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
});
