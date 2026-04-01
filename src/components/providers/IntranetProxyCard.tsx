import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Network } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { settingsApi } from "@/lib/api/settings";
import type { IntranetProxyConfig } from "@/types";

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

export function IntranetProxyCard() {
  const queryClient = useQueryClient();

  // 读取 settings 中已保存的 intranetProxy 配置
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
  });

  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [smallModel, setSmallModel] = useState("");
  const [model, setModel] = useState("");
  const [opusModel, setOpusModel] = useState("");
  const [searchApiKey, setSearchApiKey] = useState("");

  // 从 settings 中初始化表单值
  useEffect(() => {
    if (!settings) return;
    const proxy = settings.intranetProxy ?? DEFAULT_CONFIG;
    setEnabled(proxy.enabled ?? false);
    setApiKey(proxy.apiKey ?? "");
    setBaseUrl(proxy.baseUrl ?? "");
    setSmallModel(proxy.modelMapping?.smallModel ?? "");
    setModel(proxy.modelMapping?.model ?? "");
    setOpusModel(proxy.modelMapping?.opusModel ?? "");
    setSearchApiKey(proxy.searchApiKey ?? "");
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (config: IntranetProxyConfig) =>
      settingsApi.saveIntranetProxyConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast.success("内网代理配置已保存");
    },
    onError: (error: Error) => {
      toast.error(`保存失败: ${error.message}`);
    },
  });

  // 切换开关时立即保存（仅 enabled 状态变更）
  const handleToggle = (value: boolean) => {
    setEnabled(value);
    const config: IntranetProxyConfig = {
      enabled: value,
      apiKey,
      baseUrl,
      modelMapping: { smallModel, model, opusModel },
      searchApiKey,
    };
    saveMutation.mutate(config);
  };

  // 提交表单
  const handleSave = () => {
    const config: IntranetProxyConfig = {
      enabled,
      apiKey,
      baseUrl,
      modelMapping: { smallModel, model, opusModel },
      // searchApiKey 为空时默认使用 apiKey
      searchApiKey: searchApiKey || apiKey,
    };
    saveMutation.mutate(config);
  };

  return (
    <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
      {/* 顶部 toggle 行 */}
      <div className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/50">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background ring-1 ring-border">
            <Network className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium leading-none">内网代理配置</p>
            <p className="text-xs text-muted-foreground">
              配置内网 Claude Code Proxy 连接参数
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          disabled={saveMutation.isPending}
          aria-label="是否开启内网代理配置"
        />
      </div>

      {/* 展开的配置表单（仅在 enabled 时显示） */}
      {enabled && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {/* API Key */}
          <div className="space-y-1.5">
            <Label htmlFor="intranet-api-key" className="text-xs">
              API Key
            </Label>
            <Input
              id="intranet-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入供应商 API Key"
              className="h-8 text-sm"
            />
          </div>

          {/* Base URL */}
          <div className="space-y-1.5">
            <Label htmlFor="intranet-base-url" className="text-xs">
              Base URL
            </Label>
            <Input
              id="intranet-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="例如：https://your-proxy.internal/v1"
              className="h-8 text-sm"
            />
          </div>

          {/* Model Mapping */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              模型映射（Model Mapping）
            </p>
            <div className="space-y-2 pl-2">
              <div className="space-y-1.5">
                <Label htmlFor="intranet-small-model" className="text-xs">
                  small_model
                </Label>
                <Input
                  id="intranet-small-model"
                  value={smallModel}
                  onChange={(e) => setSmallModel(e.target.value)}
                  placeholder="小型模型名称"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intranet-model" className="text-xs">
                  model
                </Label>
                <Input
                  id="intranet-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="默认模型名称"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="intranet-opus-model" className="text-xs">
                  opus_model
                </Label>
                <Input
                  id="intranet-opus-model"
                  value={opusModel}
                  onChange={(e) => setOpusModel(e.target.value)}
                  placeholder="高级模型名称"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Search API Key */}
          <div className="space-y-1.5">
            <Label htmlFor="intranet-search-api-key" className="text-xs">
              Search API Key
              <span className="ml-1 text-muted-foreground">
                （留空则使用 API Key）
              </span>
            </Label>
            <Input
              id="intranet-search-api-key"
              type="password"
              value={searchApiKey}
              onChange={(e) => setSearchApiKey(e.target.value)}
              placeholder="安全验证密钥，默认同 API Key"
              className="h-8 text-sm"
            />
          </div>

          {/* 保存按钮 */}
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "保存中..." : "保存配置"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
