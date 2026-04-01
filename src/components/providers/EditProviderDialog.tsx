import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FullScreenPanel } from "@/components/common/FullScreenPanel";
import type { Provider } from "@/types";
import {
  ProviderForm,
  type ProviderFormValues,
} from "@/components/providers/forms/ProviderForm";
import { openclawApi, providersApi, vscodeApi, type AppId } from "@/lib/api";
import { settingsApi } from "@/lib/api/settings";
import { IntranetProxyForm, type IntranetProxyFormRef } from "@/components/providers/IntranetProxyForm";

interface EditProviderDialogProps {
  open: boolean;
  provider: Provider | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (provider: Provider) => Promise<void> | void;
  appId: AppId;
  isProxyTakeover?: boolean; // 代理接管模式下不读取 live（避免显示被接管后的代理配置）
}

export function EditProviderDialog({
  open,
  provider,
  onOpenChange,
  onSubmit,
  appId,
  isProxyTakeover = false,
}: EditProviderDialogProps) {
  const { t } = useTranslation();
  const [isFormSubmitting, setIsFormSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<"provider" | "intranet">("provider");
  const intranetFormRef = useRef<IntranetProxyFormRef>(null);

  // 查询内网代理配置状态（仅 Claude 应用需要）
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
    enabled: appId === "claude",
  });
  const isIntranetProxyEnabled = appId === "claude" && settings?.intranetProxy?.enabled === true;

  // 默认使用传入的 provider.settingsConfig，若当前编辑对象是"当前生效供应商"，则尝试读取实时配置替换初始值
  const [liveSettings, setLiveSettings] = useState<Record<
    string,
    unknown
  > | null>(null);

  // 使用 ref 标记是否已经加载过，防止重复读取覆盖用户编辑
  const [hasLoadedLive, setHasLoadedLive] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!open || !provider) {
        setLiveSettings(null);
        setHasLoadedLive(false);
        return;
      }

      // 关键修复：只在首次打开时加载一次
      if (hasLoadedLive) {
        return;
      }

      // 修复闪烁：Claude 应用需等待 settings 查询完成后再决定是否读取 live config。
      // 若 settings 尚未返回（undefined），isIntranetProxyEnabled 会被误判为 false，
      // 导致读取已被 clearClaudeSettingsEnv 清除 API Key 的 live 配置，表单闪烁。
      if (appId === "claude" && settings === undefined) {
        return;
      }

      // 代理接管模式：Live 配置已被代理改写，读取 live 会导致编辑界面展示代理地址/占位符等内容
      // 因此直接回退到 SSOT（数据库）配置，避免用户困惑与误保存
      if (isProxyTakeover) {
        if (!cancelled) {
          setLiveSettings(null);
          setHasLoadedLive(true);
        }
        return;
      }

      // 内网代理模式：启用内网代理后 clearClaudeSettingsEnv 会清除 ~/.claude/settings.json 中的
      // ANTHROPIC_AUTH_TOKEN/ANTHROPIC_API_KEY 等字段，导致 live 配置缺少 API Key 信息。
      // 读取 live 会导致编辑界面的 API Key 输入框消失（hasApiKeyField 返回 false）。
      // 因此直接回退到 SSOT（数据库）配置，保留完整的供应商配置信息。
      if (isIntranetProxyEnabled) {
        if (!cancelled) {
          setLiveSettings(null);
          setHasLoadedLive(true);
        }
        return;
      }

      // OpenCode uses additive mode - each provider's config is stored independently in DB
      // Reading live config would return the full opencode.json (with $schema, provider, mcp etc.)
      // instead of just the provider fragment, causing incorrect nested structure on save
      if (appId === "opencode") {
        if (!cancelled) {
          setLiveSettings(null);
          setHasLoadedLive(true);
        }
        return;
      }

      if (appId === "openclaw") {
        try {
          const live = await openclawApi.getLiveProvider(provider.id);
          if (!cancelled && live && typeof live === "object") {
            setLiveSettings(live);
          } else if (!cancelled) {
            setLiveSettings(null);
          }
        } catch {
          if (!cancelled) {
            setLiveSettings(null);
          }
        } finally {
          if (!cancelled) {
            setHasLoadedLive(true);
          }
        }
        return;
      }

      try {
        const currentId = await providersApi.getCurrent(appId);
        if (currentId && provider.id === currentId) {
          try {
            const live = (await vscodeApi.getLiveProviderSettings(
              appId,
            )) as Record<string, unknown>;
            if (!cancelled && live && typeof live === "object") {
              setLiveSettings(live);
              setHasLoadedLive(true);
            }
          } catch {
            // 读取实时配置失败则回退到 SSOT（不打断编辑流程）
            if (!cancelled) {
              setLiveSettings(null);
              setHasLoadedLive(true);
            }
          }
        } else {
          if (!cancelled) {
            setLiveSettings(null);
            setHasLoadedLive(true);
          }
        }
      } finally {
        // no-op
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, provider?.id, appId, hasLoadedLive, isProxyTakeover, isIntranetProxyEnabled, settings]); // 只依赖 provider.id，不依赖整个 provider 对象；settings 用于等待查询完成

  const initialSettingsConfig = useMemo(() => {
    return (liveSettings ?? provider?.settingsConfig ?? {}) as Record<
      string,
      unknown
    >;
  }, [liveSettings, provider?.settingsConfig]); // 只依赖 settingsConfig，不依赖整个 provider

  // 固定 initialData，防止 provider 对象更新时重置表单
  const initialData = useMemo(() => {
    if (!provider) return null;
    return {
      name: provider.name,
      notes: provider.notes,
      websiteUrl: provider.websiteUrl,
      settingsConfig: initialSettingsConfig,
      category: provider.category,
      meta: provider.meta,
      icon: provider.icon,
      iconColor: provider.iconColor,
    };
  }, [
    open, // 修复：编辑保存后再次打开显示旧数据，依赖 open 确保每次打开时重新读取最新 provider 数据
    provider?.id, // 只依赖 ID，provider 对象更新不会触发重新计算
    provider?.meta, // 需要依赖 meta 以便正确初始化 testConfig 和 proxyConfig
    initialSettingsConfig,
  ]);

  const handleSubmit = useCallback(
    async (values: ProviderFormValues) => {
      if (!provider) return;

      // 注意：values.settingsConfig 已经是最终的配置字符串
      // ProviderForm 已经为不同的 app 类型（Claude/Codex/Gemini）正确组装了配置
      const parsedConfig = JSON.parse(values.settingsConfig) as Record<
        string,
        unknown
      >;

      const updatedProvider: Provider = {
        ...provider,
        name: values.name.trim(),
        notes: values.notes?.trim() || undefined,
        websiteUrl: values.websiteUrl?.trim() || undefined,
        settingsConfig: parsedConfig,
        icon: values.icon?.trim() || undefined,
        iconColor: values.iconColor?.trim() || undefined,
        ...(values.presetCategory ? { category: values.presetCategory } : {}),
        // 保留或更新 meta 字段
        ...(values.meta ? { meta: values.meta } : {}),
      };

      await onSubmit(updatedProvider);
      onOpenChange(false);
    },
    [onSubmit, onOpenChange, provider],
  );

  // 内网 Tab 时点击保存：调用 IntranetProxyForm 的 save 并关闭面板
  // 注意：useCallback 必须在条件返回之前调用，遵循 React Hooks 规则
  const handleIntranetSave = useCallback(async () => {
    if (!intranetFormRef.current) return;
    try {
      await intranetFormRef.current.save();
      onOpenChange(false);
    } catch {
      // save 内部已 toast.error，这里不再重复处理
    }
  }, [onOpenChange]);

  if (!provider || !initialData) {
    return null;
  }

  // 仅 Claude 供应商显示"内网配置" Tab
  const showIntranetTab = appId === "claude";

  // 根据当前 Tab 切换 Footer 按钮行为
  const isIntranetTab = showIntranetTab && activeTab === "intranet";

  return (
    <FullScreenPanel
      isOpen={open}
      title={t("provider.editProvider")}
      onClose={() => onOpenChange(false)}
      footer={
        isIntranetTab ? (
          <Button
            onClick={() => void handleIntranetSave()}
            disabled={intranetFormRef.current?.isSaving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Save className="h-4 w-4 mr-2" />
            {t("common.save")}
          </Button>
        ) : (
          <Button
            type="submit"
            form="provider-form"
            disabled={isFormSubmitting}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Save className="h-4 w-4 mr-2" />
            {t("common.save")}
          </Button>
        )
      }
    >
      {showIntranetTab ? (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "provider" | "intranet")}
        >
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="provider">供应商配置</TabsTrigger>
            <TabsTrigger value="intranet">内网配置</TabsTrigger>
          </TabsList>
          <TabsContent value="provider" className="mt-0">
            <ProviderForm
              appId={appId}
              providerId={provider.id}
              submitLabel={t("common.save")}
              onSubmit={handleSubmit}
              onCancel={() => onOpenChange(false)}
              onSubmittingChange={setIsFormSubmitting}
              initialData={initialData}
              showButtons={false}
            />
          </TabsContent>
          {/* forceMount 确保组件在 Dialog 打开时立即挂载，useQuery 和 useEffect 才能及时触发反写 */}
          <TabsContent value="intranet" className="mt-0 data-[state=inactive]:hidden" forceMount>
            <IntranetProxyForm ref={intranetFormRef} />
          </TabsContent>
        </Tabs>
      ) : (
        <ProviderForm
          appId={appId}
          providerId={provider.id}
          submitLabel={t("common.save")}
          onSubmit={handleSubmit}
          onCancel={() => onOpenChange(false)}
          onSubmittingChange={setIsFormSubmitting}
          initialData={initialData}
          showButtons={false}
        />
      )}
    </FullScreenPanel>
  );
}
