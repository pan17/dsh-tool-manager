window.__ModuleLoader__.load({
	id: "dsh-tool-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const reactDom = require("react-dom");
		const h = react.createElement;
		const inject = ["slots"];

		const css = [
			".tm_root{display:flex;flex-direction:column;gap:14px;max-width:1040px;padding:2px 0 30px;color:var(--dsw-alias-label-primary,#e7e9ed)}",
			".tm_head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}",
			".tm_head h2{font-size:18px;margin:0 0 5px}.tm_muted{color:var(--dsw-alias-label-secondary,#9097a4);font-size:12px;line-height:1.5}",
			".tm_preset_picker{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.tm_preset_picker label{font-size:12px;color:var(--dsw-alias-label-secondary,#9097a4)}.tm_select_wrap{position:relative;display:inline-flex;max-width:100%}.tm_select_wrap:after{content:'';position:absolute;right:12px;top:50%;width:7px;height:7px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:translateY(-70%) rotate(45deg);pointer-events:none;opacity:.9}.tm_preset_select,.tm_btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));color:inherit;padding:7px 10px;font:inherit;font-size:12px}.tm_preset_select{min-width:min(360px,100%);cursor:pointer;padding-right:34px}.tm_preset_select option{background:var(--dsw-alias-bg-base,#17191d);color:inherit}.tm_btn{cursor:pointer}.tm_btn.primary{background:#5367e8;border-color:#5367e8;color:#fff}.tm_btn:disabled{opacity:.5;cursor:not-allowed}",
			".tm_panel{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.06));overflow:hidden}",
			".tm_panel_head{padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;position:relative}.tm_panel_head b{font-size:14px}",
			".tm_tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:0}.tm_tool{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13))}.tm_tool_name{font:600 12px ui-monospace,SFMono-Regular,Consolas,monospace}.tm_tool_desc{font-size:11px;color:var(--dsw-alias-label-secondary,#9097a4);line-height:1.4;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
			".tm_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tm_input{box-sizing:border-box;min-width:130px;flex:1;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:7px;background:var(--dsw-alias-bg-base,#17191d);color:inherit;padding:7px 9px;font:inherit;font-size:12px}.tm_code{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#9da8ff}.tm_notice{padding:12px;border-radius:9px;background:color-mix(in srgb,#f59e0b 12%,transparent);font-size:12px}.tm_error{padding:12px;border-radius:9px;background:color-mix(in srgb,#ef4444 12%,transparent);color:#fca5a5;font-size:12px}",
			".tm_filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.tm_chip{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:999px;background:transparent;color:inherit;padding:4px 9px;cursor:pointer;font:inherit;font-size:11px}.tm_chip.active{border-color:#7c8cff;background:color-mix(in srgb,#7c8cff 16%,transparent)}",
			".tm_stats{display:flex;flex-wrap:nowrap;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13))}.tm_stat{flex:1 1 0;min-width:0;padding:6px 7px;border-radius:7px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.07));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.15))}.tm_stat_value{font-size:15px;font-weight:700;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tm_stat_label{margin-top:2px;font-size:10px;line-height:1.3;color:var(--dsw-alias-label-secondary,#9097a4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media(max-width:560px){.tm_stats{flex-wrap:wrap}.tm_stat{flex:1 1 30%}}",
			".tm_token{display:inline-flex;align-items:center;margin-left:6px;padding:1px 6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));border-radius:999px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.09));font:600 10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-secondary,#9097a4);white-space:nowrap;vertical-align:middle}.tm_tool>.tm_token{margin-left:auto;flex:0 0 auto}.tm_stat_extra{margin-top:1px;font-size:9.5px;line-height:1.3;color:var(--dsw-alias-label-secondary,#9097a4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
			".tm_help{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;margin-left:6px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:50%;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));color:var(--dsw-alias-label-secondary,#9097a4);font:700 10px/1 ui-sans-serif,system-ui,sans-serif;cursor:help;vertical-align:middle;outline:none}.tm_help:hover,.tm_help:focus-visible{border-color:#7c8cff;color:#9da8ff}.tm_help::after{content:attr(data-tip);position:absolute;left:0;top:calc(100% + 6px);width:min(520px,calc(100vw - 48px));max-width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:9px;background:var(--dsw-alias-bg-base,#17191d);box-shadow:0 14px 40px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary,#e7e9ed);font:400 12px/1.65 ui-sans-serif,system-ui,sans-serif;white-space:pre-line;text-align:left;opacity:0;visibility:hidden;pointer-events:none;z-index:30;transition:opacity .12s ease}.tm_help:hover::after,.tm_help:focus-visible::after{opacity:1;visibility:visible}",
			".tm_badge{display:inline-block;margin-left:6px;padding:2px 7px;border:1px solid transparent;border-radius:999px;font-size:10px;font-weight:700;line-height:1.35;letter-spacing:.02em;vertical-align:middle;color:#fff}.tm_badge.off{background:#b42318;border-color:#d92d20;color:#fff}.tm_badge.cold{background:#4338ca;border-color:#6366f1;color:#fff}.tm_badge.live{background:#15803d;border-color:#22c55e;color:#fff}.tm_badge.ptc{background:#6d28d9;border-color:#a78bfa;color:#fff}.tm_badge.native{background:#334155;border-color:#64748b;color:#fff}",
			".tm_group{border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13))}.tm_group:last-child{border-bottom:0}",
			".tm_group_bar{display:flex;align-items:center;gap:8px;padding:11px 14px}",
			".tm_chevron{appearance:none;border:0;background:transparent;color:inherit;width:28px;height:28px;border-radius:7px;cursor:pointer;font:16px/1 inherit;flex:0 0 auto}.tm_chevron:hover{background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.1))}",
			".tm_group_main{appearance:none;border:0;background:transparent;color:inherit;text-align:left;flex:1;min-width:0;cursor:pointer;padding:0}",
			".tm_group_title{font-size:13px;font-weight:600;line-height:1.3}.tm_group_sub{font-size:11px;color:var(--dsw-alias-label-secondary,#9097a4);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".tm_group_count{flex:0 0 auto;font-size:12px;color:var(--dsw-alias-label-secondary,#9097a4)}",
			".tm_group_body{padding:0 14px 12px 50px}",
			".tm_member{padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.08))}.tm_member:last-child{border-bottom:0}",
			".tm_modal{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px}",
			".tm_modal_mask{position:absolute;inset:0;background:rgba(0,0,0,.55)}",
			".tm_modal_card{position:relative;z-index:1;width:min(720px,100%);max-height:min(84vh,760px);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:14px;background:var(--dsw-alias-bg-base,#17191d);box-shadow:0 24px 80px rgba(0,0,0,.45)}",
			".tm_modal_head{padding:16px 16px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex:0 0 auto}.tm_modal_head h3{margin:0;font-size:16px}",
			".tm_modal_body{padding:0 16px 12px;display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable}",
			".tm_modal_foot{padding:12px 16px 16px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));flex:0 0 auto}.tm_confirm_card{width:min(460px,100%)}.tm_timeout_field{display:flex;align-items:center;gap:8px}.tm_timeout_field .tm_input{max-width:120px;flex:0 0 120px}.tm_preview_body{padding-right:10px}.tm_preview_panel{flex:0 0 auto;overflow:visible}.tm_preview_meta{min-width:0;flex:1}.tm_preview_desc{margin-top:4px;white-space:normal;overflow-wrap:anywhere;word-break:break-word;color:var(--dsw-alias-label-secondary,#9097a4);font-size:12px;line-height:1.55}",
			".tm_picker{min-height:180px;max-height:min(46vh,420px);overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.06))}",
			".tm_pick{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.1))}.tm_pick:last-child{border-bottom:0}.tm_copy_meta{font-size:11px;color:var(--dsw-alias-label-secondary,#9097a4);line-height:1.45;margin-top:3px;overflow-wrap:anywhere}",
			".tm_banner{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:10001;display:flex;align-items:flex-start;gap:14px;width:min(720px,calc(100vw - 32px));padding:12px 14px;border:1px solid #b45309;border-radius:12px;background:color-mix(in srgb,#f59e0b 18%,var(--dsw-alias-bg-base,#17191d));box-shadow:0 16px 48px rgba(0,0,0,.42);font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary,#e7e9ed)}",
			".tm_banner_body{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}.tm_banner_line{overflow-wrap:anywhere}",
		].join("");

		function installCss() {
			if (typeof document === "undefined") return;
			const old = document.querySelector('style[data-plugin-css="dsh-tool-manager"]');
			if (old) { old.textContent = css; return; }
			const tag = document.createElement("style");
			tag.dataset.pluginCss = "dsh-tool-manager";
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		function api(path, options) {
			const url = typeof document !== "undefined"
				? new URL("tool-manager/api" + path, document.baseURI).toString()
				: "/tool-manager/api" + path;
			return fetch(url, {
				headers: { "Content-Type": "application/json" },
				...options,
			}).then(async (response) => {
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					const error = new Error(body.message || "HTTP " + response.status);
					// 503 means the Host is between service instances (a plugin
					// node is reloading), which is worth retrying; every other
					// status is an answer.
					error.status = response.status;
					throw error;
				}
				return body;
			});
		}

		function clone(value) { return JSON.parse(JSON.stringify(value)); }
		function newKey() { return "g-" + Math.random().toString(36).slice(2, 10); }
		function withGroupKeys(value) {
			const next = clone(value);
			for (const item of next.presets || []) {
				for (const group of item.policy.groups || []) {
					if (!group._key) group._key = newKey();
				}
			}
			return next;
		}
		function policyPayload(policy) {
			return {
				disabled: [...(policy.disabled || [])],
				groups: (policy.groups || []).map((group) => ({
					name: group.name,
					...(group.description ? { description: group.description } : {}),
					patterns: [...(group.patterns || [])],
				})),
			};
		}
		/**
		 * Project one Preset's whole policy onto another Preset.
		 *
		 * The target is meant to be overwritten, so its current groups and
		 * disabled names are ignored. Copy only what the target can actually
		 * expose: group membership is limited to tools present in both
		 * Presets, and a group whose members all disappear is skipped instead
		 * of becoming an invalid empty group. Old wildcard patterns are
		 * expanded to exact names, matching what the group editor shows.
		 */
		function copyPresetPolicy(sourcePreset, targetPreset) {
			const sourceTools = sourcePreset.tools || [];
			const sourcePolicy = sourcePreset.policy || { disabled: [], groups: [] };
			const targetNames = new Set((targetPreset.tools || []).map((tool) => tool.name));
			const sourceNames = new Set(sourceTools.map((tool) => tool.name));
			const disabled = (sourcePolicy.disabled || [])
				.filter((name) => sourceNames.has(name) && targetNames.has(name));
			const claimed = new Set(disabled);
			const groups = [];
			const skippedGroups = [];
			for (const group of sourcePolicy.groups || []) {
				const members = [];
				for (const tool of matchingTools(sourceTools, group.patterns || [])) {
					if (!targetNames.has(tool.name) || claimed.has(tool.name)) continue;
					claimed.add(tool.name);
					members.push(tool.name);
				}
				if (members.length === 0) {
					skippedGroups.push(group.name || "未命名分组");
					continue;
				}
				groups.push({
					name: group.name,
					...(group.description ? { description: group.description } : {}),
					patterns: members,
				});
			}
			return { disabled, groups, skippedGroups };
		}
		function settingsPayload(value) {
			const settings = { presets: {} };
			for (const item of value && value.presets || []) settings.presets[item.id] = policyPayload(item.policy);
			return settings;
		}
		function settingsSignature(value) {
			return JSON.stringify(settingsPayload(value));
		}
		function matchesPattern(value, pattern) {
			if (!pattern.includes("*")) return value === pattern;
			const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
			return new RegExp("^" + escaped + "$").test(value);
		}
		function matchingTools(tools, patterns) {
			return (tools || []).filter((tool) => (patterns || []).some((pattern) => matchesPattern(tool.name, pattern)));
		}
		function groupedNames(preset, exceptKey) {
			const names = new Set();
			for (const group of preset.policy.groups || []) {
				if (exceptKey && group._key === exceptKey) continue;
				for (const tool of matchingTools(preset.tools, group.patterns)) names.add(tool.name);
			}
			return names;
		}
		function eligibleGroupTools(preset, exceptKey) {
			const disabled = new Set(preset.policy.disabled || []);
			const occupied = groupedNames(preset, exceptKey);
			return (preset.tools || []).filter((tool) => !disabled.has(tool.name) && !occupied.has(tool.name));
		}
		function groupDraftIssues(preset) {
			const disabled = new Set(preset.policy.disabled || []);
			const owners = new Map();
			const empty = [];
			const disabledMembers = [];
			for (const group of preset.policy.groups || []) {
				const members = matchingTools(preset.tools, group.patterns);
				if (!members.some((tool) => !disabled.has(tool.name))) empty.push(group.name || "未命名分组");
				for (const tool of members) {
					if (disabled.has(tool.name)) disabledMembers.push({ tool: tool.name, group: group.name || "未命名分组" });
					const groups = owners.get(tool.name) || [];
					groups.push(group.name || "未命名分组");
					owners.set(tool.name, groups);
				}
			}
			const duplicates = [...owners].filter(([, groups]) => groups.length > 1);
			return { empty, disabledMembers, duplicates };
		}
		function catalogStats(preset) {
			const disabled = new Set(preset.policy.disabled || []);
			const grouped = groupedNames(preset);
			let ungroupedTools = 0;
			let onDemandTools = 0;
			let disabledTools = 0;
			for (const tool of preset.tools || []) {
				if (disabled.has(tool.name)) disabledTools += 1;
				else if (grouped.has(tool.name)) onDemandTools += 1;
				else ungroupedTools += 1;
			}
			return { totalTools: (preset.tools || []).length, groupCount: (preset.policy.groups || []).length, ungroupedTools, onDemandTools, disabledTools };
		}
		// Token estimates mirror the Host's `@deepseek-ai/dsh-token-meter/estimate`
		// (4 characters per token) so the editor updates live while groups are
		// dragged around in the draft, before a save reaches the Host snapshot.
		function estimateToolTokens(tool) {
			try {
				return Math.ceil(JSON.stringify({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				}).length / 4);
			} catch {
				return null;
			}
		}
		function estimateToolsTokens(tools) {
			const list = (tools || []).map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}));
			if (list.length === 0) return 0;
			try {
				return Math.ceil(JSON.stringify(list).length / 4) + 4;
			} catch {
				return null;
			}
		}
		function escapeCatalogText(value) {
			return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
		}
		function renderCatalogLine(group, members) {
			const heading = "- " + escapeCatalogText(group.name || "") + " (" + members.length + " tools)"
				+ (group.description ? ": " + escapeCatalogText(group.description) : "");
			return heading + "\n  Tools: " + members.map((tool) => escapeCatalogText(tool.name)).join(", ");
		}
		// A snapshot priced by the running transport carries the per-tool number;
		// the JSON projection is what remains for a native preset or a draft row.
		function toolTokens(tool) {
			if (typeof tool.tokens === "number" && Number.isFinite(tool.tokens)) return tool.tokens;
			return estimateToolTokens(tool);
		}
		function estimateGroupTokens(group, members) {
			if (members.length === 0) return { schema: 0, catalog: 0, net: 0 };
			let schema = 0;
			for (const tool of members) {
				const tokens = toolTokens(tool);
				if (tokens === null) return null;
				schema += tokens;
			}
			const catalog = Math.ceil(renderCatalogLine(group, members).length / 4);
			return { schema, catalog, net: schema - catalog };
		}
		function activeGroupViews(preset) {
			const disabled = new Set(preset.policy.disabled || []);
			const claimed = new Set();
			const active = [];
			for (const group of preset.policy.groups || []) {
				const members = matchingTools(preset.tools, group.patterns)
					.filter((tool) => !disabled.has(tool.name) && !claimed.has(tool.name));
				if (members.length === 0) continue;
				for (const tool of members) claimed.add(tool.name);
				active.push({ group, members });
			}
			return { active, claimed, disabled };
		}
		function presetTokenStats(preset) {
			const { active, claimed, disabled } = activeGroupViews(preset);
			const allTools = preset.tools || [];
			const alwaysOn = allTools.filter((tool) => !disabled.has(tool.name) && !claimed.has(tool.name));
			const onDemand = allTools.filter((tool) => claimed.has(tool.name));
			const disabledTools = allTools.filter((tool) => disabled.has(tool.name));
			let onDemandTokens = 0;
			let onDemandSavings = 0;
			for (const item of active) {
				const tokens = estimateGroupTokens(item.group, item.members);
				if (tokens) {
					onDemandTokens += tokens.schema;
					onDemandSavings += tokens.net;
				}
			}
			// A transport that renders one document (PTC) is priced per tool plus a
			// fixed floor; the JSON projection prices whole arrays by itself.
			const additive = preset.transport === "ptc";
			const resident = (list) => list.reduce((sum, tool) => {
				const tokens = toolTokens(tool);
				return sum + (typeof tokens === "number" ? tokens : 0);
			}, 0);
			const constantTokens = typeof preset.constantTokens === "number" && Number.isFinite(preset.constantTokens) ? preset.constantTokens : 0;
			return {
				totalTokens: additive ? resident(allTools) + constantTokens : estimateToolsTokens(allTools),
				alwaysOnTools: alwaysOn.length,
				alwaysOnTokens: additive ? resident(alwaysOn) : estimateToolsTokens(alwaysOn),
				onDemandTools: onDemand.length,
				onDemandTokens,
				onDemandGroups: active.length,
				onDemandSavings,
				disabledTools: disabledTools.length,
				disabledTokens: additive ? resident(disabledTools) : estimateToolsTokens(disabledTools),
			};
		}
		function groupTokenEstimates(preset) {
			const map = new Map();
			for (const item of activeGroupViews(preset).active) {
				map.set(item.group._key || item.group.name, estimateGroupTokens(item.group, item.members));
			}
			return map;
		}
		function formatTokenCount(value) {
			if (typeof value !== "number" || !Number.isFinite(value)) return "—";
			if (Math.abs(value) >= 1000) {
				return String(Math.round(value / 100) / 10).replace(/\.0$/, "") + "k";
			}
			return String(Math.round(value));
		}
		function formatTokenAmount(value) {
			return typeof value === "number" && Number.isFinite(value) ? "~" + formatTokenCount(value) : "—";
		}
		function tokenBadge(tokens, title) {
			if (typeof tokens !== "number" || !Number.isFinite(tokens)) {
				return h("span", { className: "tm_token", title: "估算不可用（4 字符/token）" }, "—");
			}
			return h("span", { className: "tm_token", title: title || "估算（4 字符/token）" }, "~" + formatTokenCount(tokens) + " tok");
		}
		function matchesQuery(tool, needle) {
			if (!needle) return true;
			return tool.name.toLowerCase().includes(needle) || (tool.description || "").toLowerCase().includes(needle);
		}
		function nextGroupName(groups) {
			let i = (groups || []).length + 1;
			let name = "分组 " + i;
			while ((groups || []).some((group) => String(group.name || "").toLowerCase() === name.toLowerCase())) name = "分组 " + (++i);
			return name;
		}

		function defaultAutoGroupPrompt(tools, otherGroupNames) {
			const list = (tools || []).map((tool) => ({
				name: String(tool.name || ""),
				description: String(tool.description || "").trim().replace(/\s+/g, " "),
			}));
			const forbidden = (otherGroupNames && otherGroupNames.length > 0) ? otherGroupNames : ["（无）"];
			return [
				"请把以下尚未分组的工具按共同能力和使用场景聚类成多个按需工具组，并为每组生成中文名称和描述。",
				"要求：",
				"1. 每个工具最多出现在一个组；tools 必须使用输入中的精确工具名。",
				"2. 不要为了覆盖全部工具而制造不合理分组；不适合归组的工具放入 ungrouped。",
				"3. 避免只有一个工具的碎片组，也避免含义模糊、规模过大的杂项组；组数由工具语义决定。",
				"4. 每组名称使用简洁自然的中文，建议 2 到 10 个汉字；描述用一句简洁中文概括用途。",
				"5. 新组名称互不重复，且不得与这些现有分组重名：" + forbidden.join("、") + "。",
				"6. 只输出一个 JSON 对象，不要输出 Markdown、解释或额外字段。",
				'格式：{"groups":[{"name":"...","description":"...","tools":["exact_name"]}],"ungrouped":["exact_name"]}',
				"候选工具：",
				JSON.stringify(list, null, 2),
			].join("\n");
		}

		function defaultGroupSuggestionPrompt(tools, otherGroupNames) {
			const list = (tools || []).map((tool) => ({
				name: String(tool.name || ""),
				description: String(tool.description || "").trim().replace(/\s+/g, " "),
			}));
			const forbidden = (otherGroupNames && otherGroupNames.length > 0) ? otherGroupNames : ["（无）"];
			return [
				"请根据以下已选择的工具，为一个按需工具组生成名称和描述。",
				"要求：",
				"1. 名称使用简洁自然的中文，概括共同用途，建议 2 到 10 个汉字。",
				"2. 描述使用一句简洁中文，说明该组适合完成什么任务，不要逐个罗列工具。",
				"3. 名称不得与这些其他分组重名：" + forbidden.join("、") + "。",
				'4. 只输出一个 JSON 对象，不要输出 Markdown、解释或额外字段。格式：{"name":"...","description":"..."}',
				"已选择工具：",
				JSON.stringify(list, null, 2),
			].join("\n");
		}

		/**
		 * Frame-wide banner for things the person must know and the model cannot fix.
		 *
		 * A registry reload can leave a Session without the preset tools it was
		 * written against. When the Host cannot re-attach it, only a restart helps,
		 * and that is a message for the reader: a transcript reminder only stops the
		 * model from retrying, which is not the same as telling anyone.
		 */
		function ToolManagerNotices() {
			const [notices, setNotices] = react.useState([]);
			const [dismissing, setDismissing] = react.useState(false);

			react.useEffect(() => {
				let live = true;
				const read = () => {
					api("/notices")
						.then((value) => { if (live) setNotices(Array.isArray(value.notices) ? value.notices : []); })
						.catch(() => { /* a banner is not worth an error state */ });
				};
				read();
				// Poll rather than stream: the Host writes a notice only when a
				// registry reload failed to re-attach, which is rare and not urgent.
				const timer = setInterval(read, 15000);
				return () => { live = false; clearInterval(timer); };
			}, []);

			if (notices.length === 0) return null;
			const dismiss = () => {
				setDismissing(true);
				api("/notices", { method: "POST", body: JSON.stringify({ ids: notices.map((item) => item.id) }) })
					.then((value) => setNotices(Array.isArray(value.notices) ? value.notices : []))
					.catch(() => { /* keep the banner rather than hide an unacknowledged notice */ })
					.finally(() => setDismissing(false));
			};

			return h("div", { className: "tm_banner", role: "alert" },
				h("div", { className: "tm_banner_body" },
					notices.map((item) => h("div", { className: "tm_banner_line", key: item.id }, item.message)),
				),
				h("button", { className: "tm_btn", onClick: dismiss, disabled: dismissing }, dismissing ? "处理中…" : "知道了"),
			);
		}

		const TOOL_CATALOG_HELP = [
			"关掉后立刻对模型隐藏。按需组默认隐藏，模型要先调用 tool_list 打开所在组才能使用。",
			"",
			"tool_list 只在当前 Preset 有有效按需组时才出现（保存后从下一个模型步骤生效），没有有效按需组时模型看不到它；它由插件自动管理，不出现在本页工具目录中，也不能在这里开关或分组。",
		].join("\n");

		function ToolManagerSection() {
			const [snapshot, setSnapshot] = react.useState(null);
			const [draft, setDraft] = react.useState(null);
			const [active, setActive] = react.useState("");
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState("");
			const [message, setMessage] = react.useState("");
			const [query, setQuery] = react.useState("");
			const [filter, setFilter] = react.useState("all");
			const [modal, setModal] = react.useState(null);
			const [autoGrouping, setAutoGrouping] = react.useState(false);
			const [autoGroupError, setAutoGroupError] = react.useState("");
			const [autoPreview, setAutoPreview] = react.useState(null);
			const [copyDialog, setCopyDialog] = react.useState(null);
			const [expanded, setExpanded] = react.useState({});
			const [aiConfirm, setAiConfirm] = react.useState(null);
			const [suggestionTimeoutSeconds, setSuggestionTimeoutSeconds] = react.useState("60");
			const [autoGroupTimeoutSeconds, setAutoGroupTimeoutSeconds] = react.useState("120");

			const load = react.useCallback((attempt) => {
				const tries = attempt || 0;
				setBusy(true); setError("");
				return api("/snapshot").then((value) => {
					const next = withGroupKeys(value);
					setSnapshot(value); setDraft(next); setModal(null); setAutoPreview(null); setCopyDialog(null); setAutoGroupError("");
					setActive((current) => current && value.presets.some((p) => p.id === current) ? current : (value.presets[0] && value.presets[0].id) || "");
				}).catch((e) => {
					// The Host swaps the preset registry instance when its node
					// reloads; retrying outlasts that window instead of leaving
					// the page on an error the user cannot act on.
					if (e && e.status === 503 && tries < 6) {
						setTimeout(() => { load(tries + 1); }, 500);
						return;
					}
					setError(String(e.message || e));
				}).finally(() => setBusy(false));
			}, []);
			react.useEffect(() => { load(); }, [load]);
			const dirty = !!(snapshot && draft && settingsSignature(snapshot) !== settingsSignature(draft));
			react.useEffect(() => {
				if (!dirty) return undefined;
				function onBeforeUnload(event) {
					event.preventDefault();
					event.returnValue = "";
				}
				window.addEventListener("beforeunload", onBeforeUnload);
				return () => window.removeEventListener("beforeunload", onBeforeUnload);
			}, [dirty]);
			react.useEffect(() => {
				if (!modal && !aiConfirm && !autoPreview && !copyDialog) return undefined;
				function onKeyDown(event) {
					if (event.key === "Escape") {
						if (aiConfirm) setAiConfirm(null);
						else if (autoPreview) setAutoPreview(null);
						else if (copyDialog) setCopyDialog(null);
						else if (modal) setModal(null);
					}
				}
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [modal, aiConfirm, autoPreview, copyDialog]);

			if (!draft) return h("div", { className: "tm_root" }, error ? h("div", { className: "tm_error" }, error) : h("div", { className: "tm_muted" }, "正在读取工具目录…"));
			const preset = draft.presets.find((item) => item.id === active) || draft.presets[0];
			if (!preset) return h("div", { className: "tm_notice" }, "没有可用的 Agent Preset。");

			function mutatePreset(mutator) {
				setDraft((current) => {
					const next = clone(current);
					const target = next.presets.find((item) => item.id === preset.id);
					mutator(target, next);
					return next;
				});
				setMessage("");
			}

			function toggleTool(name) {
				mutatePreset((target) => {
					const disabled = new Set(target.policy.disabled || []);
					if (disabled.has(name)) disabled.delete(name); else disabled.add(name);
					target.policy.disabled = [...disabled];
				});
			}

			function openCreate() {
				setModal({
					mode: "create",
					key: newKey(),
					name: nextGroupName(preset.policy.groups),
					description: "",
					patterns: [],
					query: "",
					generating: false,
					generateError: "",
				});
			}

			function resetPresetConfig() {
				if (!hasPresetConfig) return;
				if (!window.confirm("确定重置当前 Preset 的配置吗？这会清空它的全部按需组和已关闭工具；只修改页面草稿，保存后生效。")) return;
				mutatePreset((target) => {
					target.policy = { disabled: [], groups: [] };
				});
				setQuery("");
				setFilter("all");
				setExpanded({});
				setMessage("已重置当前 Preset 的配置（草稿）；点击保存后生效。");
			}

			function openCopyDialog() {
				if (!hasPresetConfig || copyTargetCount === 0) return;
				setCopyDialog({ sourceId: preset.id, selected: [] });
			}

			function toggleCopyTarget(id) {
				setCopyDialog((current) => {
					if (!current) return current;
					const selected = new Set(current.selected || []);
					if (selected.has(id)) selected.delete(id); else selected.add(id);
					return { ...current, selected: [...selected] };
				});
			}

			function selectAllCopyTargets(ids) {
				setCopyDialog((current) => current ? { ...current, selected: [...ids] } : current);
			}

			function clearCopyTargets() {
				setCopyDialog((current) => current ? { ...current, selected: [] } : current);
			}

			function confirmCopy() {
				if (!copyDialog) return;
				const source = draft.presets.find((item) => item.id === copyDialog.sourceId);
				if (!source) { setCopyDialog(null); return; }
				const selected = new Set(copyDialog.selected || []);
				const plans = [];
				for (const target of draft.presets) {
					if (target.id === source.id || !selected.has(target.id) || target.broken) continue;
					const copied = copyPresetPolicy(source, target);
					const before = JSON.stringify(policyPayload(target.policy));
					const after = JSON.stringify(policyPayload({ disabled: copied.disabled, groups: copied.groups }));
					plans.push({ targetId: target.id, label: target.name || target.id, copied, changed: before !== after });
				}
				if (!plans.length) { setCopyDialog(null); return; }
				setDraft((current) => {
					const next = clone(current);
					for (const plan of plans) {
						const target = next.presets.find((item) => item.id === plan.targetId);
						if (!target) continue;
						target.policy = {
							disabled: [...plan.copied.disabled],
							groups: plan.copied.groups.map((group) => ({ ...group, _key: newKey() })),
						};
					}
					return next;
				});
				const changed = plans.filter((plan) => plan.changed);
				const unchanged = plans.length - changed.length;
				const skipped = plans.flatMap((plan) => plan.copied.skippedGroups.map((name) => plan.label + "：" + name));
				const parts = [];
				if (changed.length) {
					parts.push("已将「" + (source.name || source.id) + "」的配置复制到 "
						+ changed.map((plan) => "「" + plan.label + "」").join("、") + "（草稿），请检查后保存。");
				} else {
					parts.push("所选 Preset 的配置已与当前 Preset 一致，没有产生修改。");
				}
				if (unchanged) parts.push(unchanged + " 个 Preset 无变化。");
				if (skipped.length) parts.push("跳过 " + skipped.length + " 个无可用工具的分组：" + skipped.join("；"));
				setMessage(parts.join(" "));
				setCopyDialog(null);
			}

			function openEdit(group) {
				const members = matchingTools(preset.tools, group.patterns || []).map((tool) => tool.name);
				setModal({
					mode: "edit",
					key: group._key,
					name: group.name || "",
					description: group.description || "",
					patterns: members,
					query: "",
					generating: false,
					generateError: "",
				});
			}

			function deleteGroup(key) {
				mutatePreset((target) => {
					target.policy.groups = (target.policy.groups || []).filter((group) => group._key !== key);
				});
				setExpanded((current) => { const next = { ...current }; delete next[key]; return next; });
				setModal((current) => current && current.key === key ? null : current);
			}

			function patchModal(patch) {
				setModal((current) => current ? { ...current, ...patch } : current);
			}

			function patchAiConfirm(patch) {
				setAiConfirm((current) => current ? { ...current, ...patch } : current);
			}

			function generateGroupDetails() {
				if (!modal || modal.generating || !(modal.patterns || []).length) return;
				const key = modal.key;
				const otherGroupNames = (preset.policy.groups || [])
					.filter((group) => group._key !== key)
					.map((group) => group.name)
					.filter(Boolean);
				const eligible = new Set(eligibleGroupTools(preset, key).map((tool) => tool.name));
				const selectedTools = matchingTools(preset.tools, modal.patterns || [])
					.filter((tool) => eligible.has(tool.name));
				const toolNames = selectedTools.map((tool) => tool.name);
				if (!toolNames.length) {
					patchModal({ generateError: "所选模式当前没有匹配到工具，请重新勾选。" });
					return;
				}
				const initialPrompt = defaultGroupSuggestionPrompt(selectedTools, otherGroupNames);
				setAiConfirm({
					kind: "suggest",
					title: "确认自动生成名称和描述",
					message: "将所选工具的名称和描述发送给当前默认模型，并产生一次模型请求。",
					timeoutSeconds: suggestionTimeoutSeconds,
					prompt: initialPrompt,
					promptCustom: false,
					showPrompt: false,
					error: "",
					run: (timeoutMs, _tools, prompt) => {
						setSuggestionTimeoutSeconds(String(timeoutMs / 1000));
						patchModal({ generating: true, generateError: "" });
						api("/suggest-group", {
							method: "POST",
							body: JSON.stringify({ presetId: preset.id, toolNames, otherGroupNames, timeoutMs, prompt }),
						}).then((suggestion) => {
							setModal((current) => current && current.key === key
								? { ...current, name: suggestion.name || current.name, description: suggestion.description || current.description, generating: false, generateError: "" }
								: current);
						}).catch((e) => {
							setModal((current) => current && current.key === key
								? { ...current, generating: false, generateError: String(e.message || e) }
								: current);
						});
					},
				});
			}

			function confirmModal() {
				if (!modal) return;
				const name = String(modal.name || "").trim().replace(/\s+/g, " ");
				const description = String(modal.description || "").trim();
				const eligible = new Set(eligibleGroupTools(preset, modal.key).map((tool) => tool.name));
				const patterns = [...new Set(modal.patterns || [])].filter((toolName) => eligible.has(toolName));
				if (!name || patterns.length === 0) return;
				const created = modal.mode === "create";
				const key = modal.key;
				mutatePreset((target) => {
					if (!Array.isArray(target.policy.groups)) target.policy.groups = [];
					const clash = target.policy.groups.some((item) => item._key !== key && String(item.name || "").toLowerCase() === name.toLowerCase());
					if (clash) return;
					if (created) {
						target.policy.groups.push({ _key: key, name, description, patterns });
						return;
					}
					const group = target.policy.groups.find((item) => item._key === key);
					if (!group) return;
					group.name = name;
					group.description = description;
					group.patterns = patterns;
				});
				setModal(null);
				if (created) setExpanded((current) => ({ ...current, [key]: true }));
			}

			function autoGroupSignature(toolNames, otherGroupNames = []) {
				return preset.id + "\n" + [...toolNames].sort().join("\n") + "\n---\n" + [...otherGroupNames].sort().join("\n");
			}

			function startAutoGroup() {
				if (autoGrouping) return;
				const disabledNames = new Set(preset.policy.disabled || []);
				const alreadyGrouped = groupedNames(preset);
				const candidates = (preset.tools || []).filter((tool) => !disabledNames.has(tool.name) && !alreadyGrouped.has(tool.name));
				if (!candidates.length) {
					setAutoGroupError("当前没有未分组且未关闭的工具。");
					return;
				}
				const allCandidateNames = candidates.map((tool) => tool.name);
				const otherGroupNames = (preset.policy.groups || []).map((group) => group.name).filter(Boolean);
				const initialPrompt = defaultAutoGroupPrompt(candidates, otherGroupNames);
				setAiConfirm({
					kind: "auto-group",
					title: "确认自动分组",
					message: "筛选并勾选需要分组的工具，发送给当前默认模型进行聚类。",
					timeoutSeconds: autoGroupTimeoutSeconds,
					query: "",
					selected: allCandidateNames,
					prompt: initialPrompt,
					promptCustom: false,
					showPrompt: false,
					error: "",
					run: (timeoutMs, selectedToolNames, prompt) => {
						setAutoGroupTimeoutSeconds(String(timeoutMs / 1000));
						setAutoGrouping(true); setAutoGroupError(""); setAutoPreview(null);
						const signature = autoGroupSignature(selectedToolNames, otherGroupNames);
						api("/auto-group", {
							method: "POST",
							body: JSON.stringify({ presetId: preset.id, toolNames: selectedToolNames, otherGroupNames, timeoutMs, prompt }),
						}).then((result) => {
							setAutoPreview({ presetId: preset.id, signature, selectedTools: selectedToolNames, groups: result.groups || [], ungrouped: result.ungrouped || [] });
						}).catch((e) => setAutoGroupError(String(e.message || e))).finally(() => setAutoGrouping(false));
					},
				});
			}

			function confirmAiRequest() {
				if (!aiConfirm) return;
				const seconds = Number(aiConfirm.timeoutSeconds);
				if (!Number.isInteger(seconds) || seconds < 5 || seconds > 600) {
					patchAiConfirm({ error: "超时时间必须是 5 到 600 之间的整数秒。" });
					return;
				}
				const selected = aiConfirm.selected || [];
				let prompt = String(aiConfirm.prompt || "").trim();
				if (!prompt) {
					patchAiConfirm({ error: "提示词不能为空，请输入有效提示词或点击重置为默认。" });
					return;
				}
				if (aiConfirm.kind === "auto-group" && selected.length === 0) {
					patchAiConfirm({ error: "请至少勾选一个工具进行分组。" });
					return;
				}
				const run = aiConfirm.run;
				setAiConfirm(null);
				run(seconds * 1000, selected, prompt);
			}

			function applyAutoGroups() {
				if (!autoPreview || autoPreview.presetId !== preset.id) return;
				const disabledNames = new Set(preset.policy.disabled || []);
				const alreadyGrouped = groupedNames(preset);
				const allPresetToolNames = new Set((preset.tools || []).map((tool) => tool.name));
				const targetTools = autoPreview.selectedTools || (preset.tools || []).filter((tool) => !disabledNames.has(tool.name) && !alreadyGrouped.has(tool.name)).map((tool) => tool.name);
				const validSelected = targetTools.filter((name) => allPresetToolNames.has(name) && !disabledNames.has(name) && !alreadyGrouped.has(name));
				const currentOtherGroupNames = (preset.policy.groups || []).map((group) => group.name).filter(Boolean);
				if (autoPreview.signature !== autoGroupSignature(validSelected, currentOtherGroupNames)) {
					setAutoPreview(null);
					setAutoGroupError("所选工具或分组草稿已经变化，请重新自动分组。");
					return;
				}
				const addedKeys = [];
				mutatePreset((target) => {
					if (!Array.isArray(target.policy.groups)) target.policy.groups = [];
					for (const group of autoPreview.groups) {
						const key = newKey();
						addedKeys.push(key);
						target.policy.groups.push({ _key: key, name: group.name, description: group.description, patterns: [...group.tools] });
					}
				});
				setExpanded((current) => {
					const next = { ...current };
					for (const key of addedKeys) next[key] = true;
					return next;
				});
				setAutoPreview(null); setAutoGroupError("");
				setMessage("自动分组已加入草稿；检查后请点击保存。");
			}

			function reload() {
				if (dirty && !window.confirm("当前有未保存的修改，刷新会丢弃这些修改。确定继续吗？")) return;
				load();
			}

			function save() {
				for (const item of draft.presets || []) {
					if (item.broken) continue;
					const issues = groupDraftIssues(item);
					if (issues.disabledMembers.length) {
						const issue = issues.disabledMembers[0];
						setError("Preset “" + item.id + "”中的已关闭工具“" + issue.tool + "”不能加入分组“" + issue.group + "”。请从分组移除或重新开启该工具。");
						setMessage("");
						return;
					}
					if (issues.duplicates.length) {
						const issue = issues.duplicates[0];
						setError("Preset “" + item.id + "”中的工具“" + issue[0] + "”重复属于分组：" + issue[1].join("、") + "。每个工具只能属于一个分组。");
						setMessage("");
						return;
					}
					if (issues.empty.length) {
						setError("Preset “" + item.id + "”中的分组“" + issues.empty[0] + "”没有可用工具。请为它选择至少一个工具，或删除该分组后再保存。");
						setMessage("");
						return;
					}
				}
				const settings = settingsPayload(draft);
				setBusy(true); setError(""); setMessage("");
				api("/save", { method: "POST", body: JSON.stringify({ expectedRevision: snapshot.revision, settings }) })
					.then((value) => {
						const next = withGroupKeys(value);
						setSnapshot(value); setDraft(next); setModal(null); setCopyDialog(null);
						setMessage("已保存；运行中 Agent 将从下一个模型步骤应用新策略。");
					})
					.catch((e) => setError(String(e.message || e)))
					.finally(() => setBusy(false));
			}

			const disabled = new Set(preset.policy.disabled || []);
			const grouped = groupedNames(preset);
			const autoGroupCandidates = (preset.tools || []).filter((tool) => !disabled.has(tool.name) && !grouped.has(tool.name));
			const stats = catalogStats(preset);
			const tokenStats = presetTokenStats(preset);
			const onDemandCatalogTokens = Math.max(0, tokenStats.onDemandTokens - tokenStats.onDemandSavings);
			const isPtc = preset.transport === "ptc";
			const unitNote = isPtc ? "PTC SDK 文本 ÷4" : "工具 JSON ÷4";
			const constantTokens = typeof preset.constantTokens === "number" && Number.isFinite(preset.constantTokens) ? preset.constantTokens : 0;
			const groupTokens = groupTokenEstimates(preset);
			const presetPolicy = preset.policy || { disabled: [], groups: [] };
			const hasPresetConfig = !preset.broken
				&& ((presetPolicy.groups || []).length > 0 || (presetPolicy.disabled || []).length > 0);
			const copyTargetCount = draft.presets.filter((item) => item.id !== preset.id && !item.broken).length;
			const needle = query.trim().toLowerCase();
			const groups = preset.policy.groups || [];
			const visibleGroups = groups.filter((group) => {
				const title = String(group.name || "").toLowerCase();
				const description = String(group.description || "").toLowerCase();
				const members = matchingTools(preset.tools, group.patterns);
				if (!needle) return true;
				return title.includes(needle) || description.includes(needle) || members.some((tool) => matchesQuery(tool, needle));
			});
			const showGroups = filter === "all" || filter === "cold";
			const visibleTools = (preset.tools || []).filter((tool) => {
				if (filter === "cold") return false;
				if (!matchesQuery(tool, needle)) return false;
				if (filter === "disabled") return disabled.has(tool.name);
				if (filter === "live") return !disabled.has(tool.name) && !grouped.has(tool.name);
				return !grouped.has(tool.name);
			});
			const orphans = (preset.policy.disabled || []).filter((name) => !(preset.tools || []).some((tool) => tool.name === name));
			const modalNeedle = String(modal && modal.query || "").trim().toLowerCase();
			const modalSelected = new Set(modal ? modal.patterns || [] : []);
			const modalEligibleTools = modal ? eligibleGroupTools(preset, modal.key) : [];
			const modalEligibleNames = new Set(modalEligibleTools.map((tool) => tool.name));
			const pickerTools = modal ? (preset.tools || []).filter((tool) =>
				(modalEligibleNames.has(tool.name) || modalSelected.has(tool.name)) && matchesQuery(tool, modalNeedle)) : [];
			const visibleSelected = pickerTools.filter((tool) => modalSelected.has(tool.name)).map((tool) => tool.name);
			const modalMatchedTools = modal ? matchingTools(preset.tools, modal.patterns || []).filter((tool) => modalEligibleNames.has(tool.name)) : [];
			const modalInvalidSelected = modal ? [...modalSelected].filter((name) => !modalEligibleNames.has(name)) : [];
			const canConfirm = !!(modal && String(modal.name || "").trim() && modalMatchedTools.length > 0 && modalInvalidSelected.length === 0);
			const listedGroups = showGroups ? visibleGroups : [];
			const aiIsAutoGroup = !!(aiConfirm && aiConfirm.kind === "auto-group");
			const aiNeedle = String(aiConfirm && aiConfirm.query || "").trim().toLowerCase();
			const aiCandidates = (preset.tools || []).filter((tool) => !disabled.has(tool.name) && !grouped.has(tool.name));
			const aiVisibleCandidates = aiIsAutoGroup ? aiCandidates.filter((tool) => matchesQuery(tool, aiNeedle)) : [];
			const aiSelected = new Set(aiConfirm && aiConfirm.selected ? aiConfirm.selected : []);
			const aiVisibleSelected = aiVisibleCandidates.filter((tool) => aiSelected.has(tool.name)).map((tool) => tool.name);
			const aiPromptTrimmed = String(aiConfirm && aiConfirm.prompt || "").trim();
			const aiCanConfirm = aiPromptTrimmed.length > 0 && (!aiIsAutoGroup || aiSelected.size > 0);
			const copySource = copyDialog ? draft.presets.find((item) => item.id === copyDialog.sourceId) : null;
			const copyPreviewRows = copySource
				? draft.presets
					.filter((item) => item.id !== copySource.id)
					.map((target) => ({ target, preview: copyPresetPolicy(copySource, target) }))
				: [];
			const copySelectableIds = copyPreviewRows.filter((row) => !row.target.broken).map((row) => row.target.id);
			const copySelected = new Set(copyDialog ? copyDialog.selected || [] : []);
			const copySelectedCount = copySelectableIds.filter((id) => copySelected.has(id)).length;

			function updateAutoGroupSelection(nextSelectedNames) {
				const nextSelected = [...new Set(nextSelectedNames)];
				const patch = { selected: nextSelected, error: "" };
				if (aiConfirm && !aiConfirm.promptCustom) {
					const nextSelectedSet = new Set(nextSelected);
					const nextTools = (preset.tools || []).filter((t) => nextSelectedSet.has(t.name));
					const otherGroupNames = (preset.policy.groups || []).map((g) => g.name).filter(Boolean);
					patch.prompt = defaultAutoGroupPrompt(nextTools, otherGroupNames);
				}
				patchAiConfirm(patch);
			}

			function renderGroup(group) {
				const key = group._key;
				const open = !!expanded[key];
				const members = matchingTools(preset.tools, group.patterns);
				const estimate = groupTokens.get(key) || null;
				const title = (group.name || "").trim() || "未命名分组";
				return h("div", { className: "tm_group", key: key },
					h("div", { className: "tm_group_bar" },
						h("button", { className: "tm_chevron", title: open ? "收起" : "展开", onClick: () => setExpanded((current) => ({ ...current, [key]: !current[key] })) }, open ? "▾" : "▸"),
						h("button", { className: "tm_group_main", onClick: () => setExpanded((current) => ({ ...current, [key]: !current[key] })) },
							h("div", { className: "tm_group_title" }, title, h("span", { className: "tm_badge cold" }, "按需")),
							h("div", { className: "tm_group_sub" }, group.description || "没有描述"),
						),
						estimate && estimate.schema > 0 ? tokenBadge(estimate.net, "估算（" + unitNote + "）：组内工具 " + formatTokenAmount(estimate.schema) + " tok · 关闭时目录行 " + formatTokenAmount(estimate.catalog) + " tok · 收起净省 " + formatTokenAmount(estimate.net) + " tok/轮") : null,
						h("span", { className: "tm_group_count" }, members.length + " 个工具"),
						h("button", { className: "tm_btn", onClick: () => openEdit(group) }, "编辑"),
						h("button", { className: "tm_btn", onClick: () => deleteGroup(key) }, "删除"),
					),
					open ? h("div", { className: "tm_group_body" }, members.length
						? members.map((tool) => {
							const tokens = toolTokens(tool);
							const isDisabled = disabled.has(tool.name);
							return h("div", { className: "tm_member", key: tool.name },
								h("div", { className: "tm_tool_name" }, tool.name, isDisabled ? h("span", { className: "tm_badge off" }, "关闭") : null, tokenBadge(tokens, "估算（" + unitNote + "）：" + (isDisabled ? "已关闭，开启后常驻 " : "单工具常驻 ") + formatTokenAmount(tokens) + " tok/轮")),
								h("div", { className: "tm_tool_desc", title: tool.description }, tool.description),
							);
						})
						: h("div", { className: "tm_error" }, "无效空组：请编辑并选择至少一个可用工具，或删除该组。"),
					) : null,
				);
			}

			function renderTool(tool) {
				const enabled = !disabled.has(tool.name);
				const tokens = toolTokens(tool);
				return h("label", { className: "tm_tool", key: tool.name },
					h("input", { type: "checkbox", checked: enabled, onChange: () => toggleTool(tool.name) }),
					h("span", null,
						h("div", { className: "tm_tool_name" }, tool.name,
							!enabled ? h("span", { className: "tm_badge off" }, "关闭") : h("span", { className: "tm_badge live" }, "常开"),
						),
						h("div", { className: "tm_tool_desc", title: tool.description }, tool.description),
					),
					tokenBadge(tokens, "估算（" + unitNote + "）：" + (enabled ? "单工具常驻 " : "已关闭，开启后常驻 ") + formatTokenAmount(tokens) + " tok/轮"),
				);
			}

			const aiConfirmDialog = aiConfirm && typeof document !== "undefined" ? reactDom.createPortal(
				h("div", { className: "tm_modal", role: "dialog", "aria-modal": "true", "aria-label": aiConfirm.title },
					h("div", { className: "tm_modal_mask", onMouseDown: () => setAiConfirm(null) }),
					h("div", { className: "tm_modal_card" },
						h("div", { className: "tm_modal_head" },
							h("div", null, h("h3", null, aiConfirm.title), h("div", { className: "tm_muted" }, aiConfirm.message)),
							h("button", { className: "tm_btn", onClick: () => setAiConfirm(null) }, "关闭"),
						),
						h("div", { className: "tm_modal_body" },
							aiIsAutoGroup ? [
								h("div", { className: "tm_row", key: "row" },
									h("input", {
										className: "tm_input",
										value: aiConfirm.query || "",
										placeholder: "筛选工具名或描述",
										onChange: (e) => patchAiConfirm({ query: e.target.value }),
									}),
									h("button", {
										className: "tm_btn",
										disabled: aiVisibleCandidates.length === 0 || aiVisibleCandidates.every((tool) => aiSelected.has(tool.name)),
										onClick: () => updateAutoGroupSelection([...(aiConfirm.selected || []), ...aiVisibleCandidates.map((tool) => tool.name)]),
									}, "全选当前筛选"),
									h("button", {
										className: "tm_btn",
										disabled: aiVisibleSelected.length === 0,
										onClick: () => updateAutoGroupSelection((aiConfirm.selected || []).filter((name) => !aiVisibleSelected.includes(name))),
									}, "清除当前筛选"),
								),
								aiSelected.size === 0
									? h("div", { className: "tm_error", key: "status" }, "请至少勾选一个工具进行分组。")
									: h("div", { className: "tm_muted", key: "status" }, "已勾选 " + aiSelected.size + " / " + aiCandidates.length + " 个候选工具。自动分组会调用当前默认模型，结果仍可手动修改。"),
								aiVisibleCandidates.length
									? h("div", { className: "tm_picker", key: "picker" }, aiVisibleCandidates.map((tool) => h("label", { className: "tm_pick", key: tool.name },
										h("input", {
											type: "checkbox",
											checked: aiSelected.has(tool.name),
											onChange: (e) => {
												const next = new Set(aiConfirm.selected || []);
												if (e.target.checked) next.add(tool.name); else next.delete(tool.name);
												updateAutoGroupSelection([...next]);
											},
										}),
										h("span", null,
											h("div", { className: "tm_tool_name" }, tool.name),
											h("div", { className: "tm_tool_desc", title: tool.description }, tool.description),
										),
									)))
									: h("div", { className: "tm_muted", key: "empty", style: { padding: "12px" } }, aiCandidates.length ? "没有符合筛选的工具。" : "当前没有可分组的工具。"),
							] : null,
							h("div", {
								style: {
									border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .2))",
									borderRadius: "8px",
									padding: "10px 12px",
									background: "var(--dsw-alias-bg-layer-1, rgba(128, 128, 128, .04))",
								},
								key: "promptSection",
							},
								h("div", {
									style: {
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										gap: "8px",
										flexWrap: "wrap",
									},
								},
									h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
										h("button", {
											type: "button",
											className: "tm_btn",
											style: { fontSize: "11px", padding: "4px 8px" },
											onClick: () => patchAiConfirm({ showPrompt: !aiConfirm.showPrompt }),
										}, aiConfirm.showPrompt ? "▾ 收起提示词" : "▸ 预览与编辑提示词"),
										h("span", { className: "tm_muted" },
											aiConfirm.promptCustom
												? "已自定义（共 " + (aiConfirm.prompt || "").length + " 字符）"
												: "默认提示词（共 " + (aiConfirm.prompt || "").length + " 字符）",
										),
										aiConfirm.promptCustom ? h("span", { className: "tm_badge cold" }, "已修改") : null,
									),
									aiConfirm.showPrompt ? h("button", {
										type: "button",
										className: "tm_btn",
										style: { fontSize: "11px", padding: "4px 8px" },
										disabled: !aiConfirm.promptCustom,
										onClick: () => {
											if (aiIsAutoGroup) {
												const selectedTools = (preset.tools || []).filter((t) => aiSelected.has(t.name));
												const otherGroupNames = (preset.policy.groups || []).map((g) => g.name).filter(Boolean);
												patchAiConfirm({
													prompt: defaultAutoGroupPrompt(selectedTools, otherGroupNames),
													promptCustom: false,
													error: "",
												});
											} else if (modal) {
												const key = modal.key;
												const otherGroupNames = (preset.policy.groups || [])
													.filter((group) => group._key !== key)
													.map((group) => group.name)
													.filter(Boolean);
												const eligible = new Set(eligibleGroupTools(preset, key).map((tool) => tool.name));
												const selectedTools = matchingTools(preset.tools, modal.patterns || [])
													.filter((tool) => eligible.has(tool.name));
												patchAiConfirm({
													prompt: defaultGroupSuggestionPrompt(selectedTools, otherGroupNames),
													promptCustom: false,
													error: "",
												});
											}
										},
									}, "重置为默认提示词") : null,
								),
								aiConfirm.showPrompt ? h("div", { style: { marginTop: "8px" } },
									h("textarea", {
										className: "tm_input",
										style: {
											width: "100%",
											minHeight: "140px",
											maxHeight: "280px",
											resize: "vertical",
											fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
											fontSize: "11px",
											lineHeight: "1.45",
											whiteSpace: "pre-wrap",
										},
										value: aiConfirm.prompt || "",
										placeholder: "提示词内容...",
										onChange: (e) => patchAiConfirm({ prompt: e.target.value, promptCustom: true, error: "" }),
									}),
									!aiPromptTrimmed ? h("div", { className: "tm_error", style: { marginTop: "6px" } }, "提示词不能为空，请输入有效提示词或点击重置为默认。") : null,
								) : null,
							),
							h("label", { className: "tm_timeout_field" },
								h("span", null, "超时时间"),
								h("input", {
									className: "tm_input",
									type: "number",
									min: 5,
									max: 600,
									step: 1,
									value: aiConfirm.timeoutSeconds,
									onChange: (event) => patchAiConfirm({ timeoutSeconds: event.target.value, error: "" }),
								}),
								h("span", { className: "tm_muted" }, "秒（5–600）"),
							),
							aiConfirm.error ? h("div", { className: "tm_error" }, aiConfirm.error) : null,
						),
						h("div", { className: "tm_modal_foot" },
							h("button", { className: "tm_btn", onClick: () => setAiConfirm(null) }, "取消"),
							h("button", { className: "tm_btn primary", disabled: !aiCanConfirm, onClick: confirmAiRequest }, "确认执行"),
						),
					),
				),
				document.body,
			) : null;

			const dialog = modal && typeof document !== "undefined" ? reactDom.createPortal(
				h("div", { className: "tm_modal", role: "dialog", "aria-modal": "true", "aria-label": modal.mode === "create" ? "新建按需组" : "编辑按需组" },
					h("div", { className: "tm_modal_mask", onMouseDown: () => setModal(null) }),
					h("div", { className: "tm_modal_card" },
						h("div", { className: "tm_modal_head" },
							h("div", null,
								h("h3", null, modal.mode === "create" ? "新建按需组" : "编辑按需组"),
								h("div", { className: "tm_muted" }, "筛选后勾选要收进该组的工具。确定后会显示在按需里。"),
							),
							h("button", { className: "tm_btn", onClick: () => setModal(null) }, "关闭"),
						),
						h("div", { className: "tm_modal_body" },
							h("div", { className: "tm_row" },
								h("input", { className: "tm_input", value: modal.name, placeholder: "名称（模型用这个打开）", onChange: (e) => patchModal({ name: e.target.value, generateError: "" }) }),
								h("button", { className: "tm_btn", disabled: modal.generating || modalMatchedTools.length === 0 || modalInvalidSelected.length > 0, onClick: generateGroupDetails }, modal.generating ? "生成中…" : "自动生成名称和描述"),
							),
							modal.generateError ? h("div", { className: "tm_error" }, modal.generateError) : null,
							h("textarea", { className: "tm_input", style: { width: "100%", minHeight: "72px", resize: "vertical" }, value: modal.description, placeholder: "描述（可选）", onChange: (e) => patchModal({ description: e.target.value, generateError: "" }) }),
							h("div", { className: "tm_row" },
								h("input", { className: "tm_input", value: modal.query, placeholder: "筛选工具名或描述", onChange: (e) => patchModal({ query: e.target.value }) }),
								h("button", { className: "tm_btn", disabled: pickerTools.every((tool) => !modalEligibleNames.has(tool.name)), onClick: () => patchModal({ patterns: [...new Set([...(modal.patterns || []), ...pickerTools.filter((tool) => modalEligibleNames.has(tool.name)).map((tool) => tool.name)])], generateError: "" }) }, "全选当前筛选"),
								h("button", { className: "tm_btn", disabled: visibleSelected.length === 0, onClick: () => patchModal({ patterns: (modal.patterns || []).filter((name) => !visibleSelected.includes(name)), generateError: "" }) }, "清除当前筛选"),
							),
							modalInvalidSelected.length
								? h("div", { className: "tm_error" }, "以下工具已关闭或属于其他分组，不能加入当前组：" + modalInvalidSelected.join(", ") + "。请取消选择。")
								: h("div", { className: modalMatchedTools.length ? "tm_muted" : "tm_error" }, modalMatchedTools.length
									? "已选 " + modalMatchedTools.length + " 个工具。自动生成会调用当前默认模型，结果仍可手动修改。"
									: "每个按需组至少需要一个未关闭且未被其他组占用的工具。"),
							pickerTools.length
								? h("div", { className: "tm_picker" }, pickerTools.map((tool) => h("label", { className: "tm_pick", key: tool.name },
									h("input", {
										type: "checkbox",
										checked: modalSelected.has(tool.name),
										disabled: !modalEligibleNames.has(tool.name) && !modalSelected.has(tool.name),
										onChange: (e) => {
											const next = new Set(modal.patterns || []);
											if (e.target.checked && modalEligibleNames.has(tool.name)) next.add(tool.name); else next.delete(tool.name);
											patchModal({ patterns: [...next], generateError: "" });
										},
									}),
									h("span", null,
										h("div", { className: "tm_tool_name" }, tool.name,
											disabled.has(tool.name) ? h("span", { className: "tm_badge off" }, "已关闭")
												: (!modalEligibleNames.has(tool.name) ? h("span", { className: "tm_badge off" }, "其他组") : null)),
										h("div", { className: "tm_tool_desc", title: tool.description }, tool.description),
									),
								)))
								: h("div", { className: "tm_muted" }, preset.tools.length ? "没有符合筛选的工具。" : "这个 Preset 当前没有可见工具。"),
						),
						h("div", { className: "tm_modal_foot" },
							h("button", { className: "tm_btn", onClick: () => setModal(null) }, "取消"),
							h("button", { className: "tm_btn primary", disabled: !canConfirm || modal.generating, onClick: confirmModal }, "确定"),
						),
					),
				),
				document.body,
			) : null;

			const previewDialog = autoPreview && typeof document !== "undefined" ? reactDom.createPortal(
				h("div", { className: "tm_modal", role: "dialog", "aria-modal": "true", "aria-label": "自动分组预览" },
					h("div", { className: "tm_modal_mask", onMouseDown: () => setAutoPreview(null) }),
					h("div", { className: "tm_modal_card" },
						h("div", { className: "tm_modal_head" },
							h("div", null, h("h3", null, "自动分组预览"), h("div", { className: "tm_muted" }, "确认后只加入页面草稿，仍需点击保存。")),
							h("button", { className: "tm_btn", onClick: () => setAutoPreview(null) }, "关闭"),
						),
						h("div", { className: "tm_modal_body tm_preview_body" },
							autoPreview.groups.map((group, index) => h("div", { className: "tm_panel tm_preview_panel", key: group.name + index },
								h("div", { className: "tm_panel_head" }, h("div", { className: "tm_preview_meta" }, h("b", null, group.name), h("div", { className: "tm_preview_desc" }, group.description)), h("span", { className: "tm_group_count" }, group.tools.length + " 个工具")),
								h("div", { style: { padding: "10px 14px" } }, group.tools.map((name) => h("div", { className: "tm_member tm_tool_name", key: name }, name))),
							)),
							autoPreview.ungrouped.length ? h("div", { className: "tm_notice" }, "保持常开、未归组：", h("span", { className: "tm_code" }, autoPreview.ungrouped.join(", "))) : null,
						),
						h("div", { className: "tm_modal_foot" },
							h("button", { className: "tm_btn", onClick: () => setAutoPreview(null) }, "取消"),
							h("button", { className: "tm_btn primary", onClick: applyAutoGroups }, "确认加入草稿"),
						),
					),
				),
				document.body,
			) : null;

			const copyDialogNode = copyDialog && copySource && typeof document !== "undefined" ? reactDom.createPortal(
				h("div", { className: "tm_modal", role: "dialog", "aria-modal": "true", "aria-label": "复制当前 Preset 配置" },
					h("div", { className: "tm_modal_mask", onMouseDown: () => setCopyDialog(null) }),
					h("div", { className: "tm_modal_card" },
						h("div", { className: "tm_modal_head" },
							h("div", null,
								h("h3", null, "复制当前 Preset 配置"),
								h("div", { className: "tm_muted" }, "将当前 Preset 的全部按需组和已关闭工具复制到勾选的 Preset；只改页面草稿，保存后生效。"),
							),
							h("button", { className: "tm_btn", onClick: () => setCopyDialog(null) }, "关闭"),
						),
						h("div", { className: "tm_modal_body" },
							h("div", { className: "tm_notice" },
								"源 Preset「" + (copySource.name || copySource.id) + "」："
								+ (copySource.policy.groups || []).length + " 个按需组、"
								+ (copySource.policy.disabled || []).length + " 个已关闭工具。"
								+ "勾选的目标 Preset 现有分组和关闭项将被整份覆盖。",
							),
							h("div", { className: "tm_row" },
								h("button", {
									className: "tm_btn",
									disabled: copySelectableIds.length === 0,
									onClick: () => selectAllCopyTargets(copySelectableIds),
								}, "全选可复制项"),
								h("button", { className: "tm_btn", disabled: copySelectedCount === 0, onClick: clearCopyTargets }, "清空"),
								h("span", { className: "tm_muted" }, "已选 " + copySelectedCount + " / " + copySelectableIds.length + " 个 Preset"),
							),
							copyPreviewRows.length
								? h("div", { className: "tm_picker" }, copyPreviewRows.map(({ target, preview }) => {
									const currentGroups = (target.policy.groups || []).length;
									const currentDisabled = (target.policy.disabled || []).length;
									const meta = target.broken
										? "工具目录读取失败，暂不能复制"
										: "现有 " + currentGroups + " 个组 / " + currentDisabled + " 个关闭项 → 将复制 "
											+ preview.groups.length + " 个组 / " + preview.disabled.length + " 个关闭项"
											+ (preview.skippedGroups.length
												? "；跳过 " + preview.skippedGroups.length + " 个组：" + preview.skippedGroups.join("、")
												: "")
											+ ((target.tools || []).length === 0 ? "；目标没有可见工具，复制后配置为空" : "");
									return h("label", { className: "tm_pick", key: target.id },
										h("input", {
											type: "checkbox",
											checked: copySelected.has(target.id) && !target.broken,
											disabled: !!target.broken,
											onChange: () => toggleCopyTarget(target.id),
										}),
										h("span", null,
											h("div", { className: "tm_tool_name" },
												target.name ? target.name + " · " + target.id : target.id,
												target.broken ? h("span", { className: "tm_badge off" }, "不可用") : null,
											),
											h("div", { className: "tm_copy_meta", title: meta }, meta),
										),
									);
								}))
								: h("div", { className: "tm_muted" }, "没有其他可复制的 Preset。"),
							h("div", { className: "tm_muted" }, "提示：分组按目标 Preset 实际拥有的工具裁剪；整组都没有可用工具时会自动跳过。"),
						),
						h("div", { className: "tm_modal_foot" },
							h("button", { className: "tm_btn", onClick: () => setCopyDialog(null) }, "取消"),
							h("button", {
								className: "tm_btn primary",
								disabled: copySelectedCount === 0,
								onClick: confirmCopy,
							}, "复制到 " + copySelectedCount + " 个 Preset"),
						),
					),
				),
				document.body,
			) : null;

			const empty = listedGroups.length === 0 && visibleTools.length === 0;

			return h("div", { className: "tm_root" },
				h("div", { className: "tm_head" },
					h("div", null, h("h2", null, "Agent 工具管理"), h("div", { className: "tm_muted" }, "按每个 Agent 预设开关工具。点「手动分组」把不常用的收进按需组：平时模型看不到，需要时先查目录再打开。")),
					h("div", { className: "tm_row" },
						h("button", { className: "tm_btn", onClick: reload, disabled: busy || autoGrouping }, "刷新"),
						h("button", { className: "tm_btn primary", onClick: save, disabled: busy || autoGrouping || !draft.writable || !dirty }, busy ? "处理中…" : "保存"),
					),
				),
				dirty ? h("div", { className: "tm_notice", role: "status" }, "有未保存的修改。请点击保存；刷新或离开页面前系统会提醒你。") : null,
				!draft.writable ? h("div", { className: "tm_notice" }, "当前配置文件不可写，不能保存。") : null,
				error ? h("div", { className: "tm_error" }, error) : null,
				message ? h("div", { className: "tm_notice" }, message) : null,
				draft.configPath ? h("div", { className: "tm_muted" }, "配置文件：", h("span", { className: "tm_code" }, draft.configPath)) : null,
				h("div", { className: "tm_preset_picker" },
					h("label", { htmlFor: "tm-preset-select" }, "Agent Preset"),
					h("span", { className: "tm_select_wrap" },
						h("select", {
							id: "tm-preset-select",
							className: "tm_preset_select",
							value: preset.id,
							disabled: autoGrouping,
							onChange: (event) => { setActive(event.target.value); setQuery(""); setFilter("all"); setModal(null); setAutoPreview(null); setCopyDialog(null); setAutoGroupError(""); setExpanded({}); },
						}, draft.presets.map((item) => h("option", { key: item.id, value: item.id }, (item.name || item.id) + " · " + (item.tools || []).length + " 个工具" + (item.isDefault ? " · 默认" : "") + (item.trust === "user" ? " · 用户" : "")))),
					),
					preset.broken ? null
						: isPtc
							? h("span", { className: "tm_badge ptc", title: "本 Preset 走 PTC：工具以一份生成的 TypeScript SDK 注入系统提示词，token 按该文本 ÷4 估算（含 run_code 调用声明、PTC 指令段与 SDK 脚手架）" }, "PTC")
							: h("span", { className: "tm_badge native", title: "本 Preset 走原生 tool-calling：工具以 JSON schema 随请求发送，token 按 JSON ÷4 估算" }, "原生"),
				),
				preset.broken ? h("div", { className: "tm_error" }, preset.broken) : null,
				autoGroupError ? h("div", { className: "tm_error" }, autoGroupError) : null,
				h("section", { className: "tm_panel" },
					h("div", { className: "tm_panel_head" },
						h("div", null,
							h("b", null, "工具目录", h("span", { className: "tm_help", tabIndex: 0, "aria-label": "工具目录说明", "data-tip": TOOL_CATALOG_HELP }, "?")),
						),
						h("div", { className: "tm_row" },
							h("button", { className: "tm_btn", onClick: startAutoGroup, disabled: autoGrouping || autoGroupCandidates.length === 0, title: autoGroupCandidates.length ? "用默认模型对未分组且未关闭的工具进行聚类" : "没有可自动分组的工具" }, autoGrouping ? "自动分组中…" : "自动分组"),
							h("button", { className: "tm_btn", onClick: openCreate, disabled: autoGrouping }, "手动分组"),
							h("button", {
								className: "tm_btn",
								onClick: resetPresetConfig,
								disabled: autoGrouping || busy || !draft.writable || !hasPresetConfig,
								title: hasPresetConfig
									? "清空当前 Preset 的全部按需组和已关闭工具"
									: "当前 Preset 没有可重置的配置",
							}, "重置配置"),
							h("button", {
								className: "tm_btn",
								onClick: openCopyDialog,
								disabled: autoGrouping || busy || !draft.writable || !hasPresetConfig || copyTargetCount === 0,
								title: hasPresetConfig
									? "把当前 Preset 的分组和已关闭工具复制到其他 Preset"
									: "当前 Preset 没有可复制的分组或已关闭工具",
							}, "复制配置"),
						),
					),
					h("div", { className: "tm_stats" },
						[
							["工具总量", stats.totalTools, formatTokenAmount(tokenStats.totalTokens) + " tok", "全部 " + stats.totalTools + " 个工具合计 " + formatTokenAmount(tokenStats.totalTokens) + " tok/轮（" + unitNote + (isPtc ? "，含平台常数 " + formatTokenAmount(constantTokens) + " tok" : "") + "；全部常驻时）"],
							["分组数量", stats.groupCount, "省 " + formatTokenAmount(tokenStats.onDemandSavings) + " tok", "全部 " + tokenStats.onDemandGroups + " 个按需组收起：组内工具合计 " + formatTokenAmount(tokenStats.onDemandTokens) + " tok − 关闭态目录行 " + formatTokenAmount(onDemandCatalogTokens) + " tok = 净省 " + formatTokenAmount(tokenStats.onDemandSavings) + " tok/轮"],
							["未分组工具", stats.ungroupedTools, formatTokenAmount(tokenStats.alwaysOnTokens) + " tok", "未分组且未关闭的 " + tokenStats.alwaysOnTools + " 个工具每轮常驻 " + formatTokenAmount(tokenStats.alwaysOnTokens) + " tok"],
							["按需工具", stats.onDemandTools, formatTokenAmount(tokenStats.onDemandTokens) + " tok", "按需组内 " + tokenStats.onDemandTools + " 个工具合计 " + formatTokenAmount(tokenStats.onDemandTokens) + " tok；收起后仍会注入目录行 " + formatTokenAmount(onDemandCatalogTokens) + " tok，实际净省见「分组数量」卡"],
							["已关闭工具", stats.disabledTools, formatTokenAmount(tokenStats.disabledTokens) + " tok", "已关闭的 " + tokenStats.disabledTools + " 个工具关闭可省 " + formatTokenAmount(tokenStats.disabledTokens) + " tok/轮"],
							...(isPtc
								? [["平台常数", formatTokenAmount(constantTokens), "固定/轮", "每轮与工具选择无关的固定开销 " + formatTokenAmount(constantTokens) + " tok：run_code 调用声明、PTC 指令段、SDK 渲染脚手架与目录工具（tool_list）等。收起或关闭工具都省不掉它"]]
								: []),
						].map(([label, value, extra, title]) =>
							h("div", { className: "tm_stat", key: label }, h("div", { className: "tm_stat_value" }, value), h("div", { className: "tm_stat_label" }, label), h("div", { className: "tm_stat_extra", title }, extra)),
						),
					),
					h("div", { className: "tm_row", style: { padding: "10px 14px" } },
						h("input", { className: "tm_input", value: query, placeholder: "搜索工具名、描述或组名", onChange: (e) => setQuery(e.target.value) }),
						h("div", { className: "tm_filters" },
							[["all", "全部"], ["live", "常开"], ["cold", "按需"], ["disabled", "已关闭"]].map(([id, label]) =>
								h("button", { key: id, className: "tm_chip" + (filter === id ? " active" : ""), onClick: () => setFilter(id) }, label),
							),
						),
					),
					orphans.length ? h("div", { className: "tm_notice", style: { margin: "0 14px 10px" } },
						"策略里有已不存在的关闭项：", h("span", { className: "tm_code" }, orphans.join(", ")), " ",
						h("button", { className: "tm_btn", onClick: () => mutatePreset((target) => { target.policy.disabled = (target.policy.disabled || []).filter((name) => !orphans.includes(name)); }) }, "清除"),
					) : null,
					listedGroups.map(renderGroup),
					visibleTools.length ? h("div", { className: "tm_tools" }, visibleTools.map(renderTool)) : null,
					empty ? h("div", { className: "tm_muted", style: { padding: "14px" } },
						filter === "cold" ? (groups.length ? "没有符合筛选的按需组。" : "") : (preset.tools.length ? "没有符合筛选的工具。" : "这个 Preset 当前没有可见工具。"),
					) : null,
				),
				dialog,
				aiConfirmDialog,
				previewDialog,
				copyDialogNode,
			);
		}

		function apply(ctx) {
			installCss();
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "tool-manager",
				order: 25,
				label: "工具管理",
			}, ToolManagerSection));
			// Outside the settings page on purpose: a lost tool set has to reach the
			// reader wherever they are, not only if they open this plugin's section.
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "tool-manager.notices",
			}, ToolManagerNotices));
		}

		exports.apply = apply;
		exports.inject = inject;
		// Pure policy projection, exported for unit tests. DSH only consumes
		// apply/inject, so this does not widen the client plugin contract.
		exports.copyPresetPolicy = copyPresetPolicy;
		exports.estimateToolTokens = estimateToolTokens;
		exports.estimateToolsTokens = estimateToolsTokens;
		exports.estimateGroupTokens = estimateGroupTokens;
		exports.presetTokenStats = presetTokenStats;
		exports.formatTokenCount = formatTokenCount;
		return module.exports;
	},
});
