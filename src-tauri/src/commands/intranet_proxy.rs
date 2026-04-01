use crate::settings::{IntranetProxyConfig, IntranetProxyModelMapping};
use serde_json::json;
use std::fs;

/// 从 ~/.config/claude-code-proxy/config.json 读取配置并尝试解析
fn read_proxy_config_file() -> Option<IntranetProxyConfig> {
    let config_path = crate::config::get_home_dir()
        .join(".config")
        .join("claude-code-proxy")
        .join("config.json");

    let content = fs::read_to_string(&config_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&content).ok()?;

    // config.json 使用的字段名：apiKey / baseURL / modelMapping.small_model 等
    let api_key = v
        .get("apiKey")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let base_url = v
        .get("baseURL")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let search_api_key = v
        .get("searchApiKey")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let model_mapping = v.get("modelMapping").and_then(|m| {
        let small_model = m
            .get("small_model")
            .and_then(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let model = m
            .get("model")
            .and_then(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let opus_model = m
            .get("opus_model")
            .and_then(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        if small_model.is_some() || model.is_some() || opus_model.is_some() {
            Some(IntranetProxyModelMapping {
                small_model,
                model,
                opus_model,
            })
        } else {
            None
        }
    });

    // 至少有一个字段有值才认为 config.json 有效数据
    if api_key.is_none() && base_url.is_none() && model_mapping.is_none() {
        return None;
    }

    Some(IntranetProxyConfig {
        enabled: true,
        api_key,
        base_url,
        model_mapping,
        search_api_key,
    })
}

/// 返回有效的内网代理配置：
/// - 若 settings 中的 intranetProxy 有实质内容（apiKey/baseUrl 非空），直接使用
/// - 否则回退到 config.json 中读取（兼容手动写入场景）
/// - 最终兜底返回默认空配置
pub fn effective_intranet_proxy_config(
    stored: Option<&IntranetProxyConfig>,
) -> IntranetProxyConfig {
    // 判断 stored 是否有实质内容
    let has_content = stored.map(|c| {
        c.api_key.as_deref().is_some_and(|s| !s.is_empty())
            || c.base_url.as_deref().is_some_and(|s| !s.is_empty())
    }).unwrap_or(false);

    if has_content {
        return stored.unwrap().clone();
    }

    // 尝试从 config.json 回填
    if let Some(from_file) = read_proxy_config_file() {
        // 保留 stored 中的 enabled 状态（如果有），合并 config.json 中的数据
        let enabled = stored.map(|c| c.enabled).unwrap_or(from_file.enabled);
        return IntranetProxyConfig {
            enabled,
            ..from_file
        };
    }

    // 兜底：返回 stored 或默认值
    stored.cloned().unwrap_or_default()
}

/// 从 config.json 同步配置到 settings.json，并返回同步后的配置
/// 若 config.json 不存在或无有效数据，返回错误
#[tauri::command]
pub async fn sync_intranet_proxy_from_file() -> Result<IntranetProxyConfig, String> {
    let from_file =
        read_proxy_config_file().ok_or_else(|| "config.json 不存在或无有效数据".to_string())?;

    // 保留 settings.json 中已有的 enabled 状态
    let existing = crate::settings::get_settings();
    let enabled = existing
        .intranet_proxy
        .as_ref()
        .map(|c| c.enabled)
        .unwrap_or(from_file.enabled);

    let merged = IntranetProxyConfig {
        enabled,
        ..from_file
    };

    // 持久化到 settings.json
    {
        let mut settings = crate::settings::get_settings();
        settings.intranet_proxy = Some(merged.clone());
        crate::settings::update_settings(settings).map_err(|e| e.to_string())?;
    }

    Ok(merged)
}

/// 保存内网代理配置
/// 1. 将配置持久化到 AppSettings（~/.cc-switch/settings.json）
/// 2. 同步覆盖写入 ~/.config/claude-code-proxy/config.json
#[tauri::command]
pub async fn save_intranet_proxy_config(config: IntranetProxyConfig) -> Result<(), String> {
    // 1. 持久化到 AppSettings
    {
        let mut settings = crate::settings::get_settings();
        settings.intranet_proxy = Some(config.clone());
        crate::settings::update_settings(settings).map_err(|e| e.to_string())?;
    }

    // 2. 如果启用，同步写入 ~/.config/claude-code-proxy/config.json
    if config.enabled {
        write_proxy_config_file(&config).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 清除 ~/.claude/settings.json 中的外网 Anthropic 环境变量
/// 切换到内网模式保存时调用，删除 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
#[tauri::command]
pub async fn clear_claude_settings_env() -> Result<(), String> {
    let path = crate::config::get_claude_settings_path();

    // 若文件不存在，直接返回 Ok
    if !path.exists() {
        return Ok(());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut v: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // 仅删除 env 对象中的三个外网 key，保留其他字段
    let keys_to_remove = ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"];
    if let Some(env) = v.get_mut("env").and_then(|e| e.as_object_mut()) {
        for key in &keys_to_remove {
            env.remove(*key);
        }
    }

    let new_content = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    fs::write(&path, new_content).map_err(|e| e.to_string())?;

    Ok(())
}

/// 将配置写入 ~/.config/claude-code-proxy/config.json（完整覆盖）
fn write_proxy_config_file(config: &IntranetProxyConfig) -> Result<(), crate::error::AppError> {
    let proxy_dir = crate::config::get_home_dir()
        .join(".config")
        .join("claude-code-proxy");
    fs::create_dir_all(&proxy_dir).map_err(|e| {
        crate::error::AppError::Message(format!("创建目录失败: {}", e))
    })?;

    let config_path = proxy_dir.join("config.json");

    // 构建 modelMapping（snake_case key），值为字符串
    let empty_mapping = IntranetProxyModelMapping::default();
    let mapping = config.model_mapping.as_ref().unwrap_or(&empty_mapping);

    let file_json = json!({
        "apiKey": config.api_key.clone().unwrap_or_default(),
        "baseURL": config.base_url.clone().unwrap_or_default(),
        "modelMapping": {
            "small_model": mapping.small_model.clone().unwrap_or_default(),
            "model": mapping.model.clone().unwrap_or_default(),
            "opus_model": mapping.opus_model.clone().unwrap_or_default(),
        },
        "searchApiKey": config.search_api_key.clone()
            .or_else(|| config.api_key.clone())
            .unwrap_or_default(),
    });

    let content = serde_json::to_string_pretty(&file_json)
        .map_err(|e| crate::error::AppError::Message(format!("序列化失败: {}", e)))?;

    fs::write(&config_path, content)
        .map_err(|e| crate::error::AppError::Message(format!("写入文件失败: {}", e)))?;

    Ok(())
}
