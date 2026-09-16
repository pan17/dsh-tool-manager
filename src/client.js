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
			".tm_panel_head{padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.tm_panel_head b{font-size:14px}",
			".tm_tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:0}.tm_tool{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13))}.tm_tool_name{font:600 12px ui-monospace,SFMono-Regular,Consolas,monospace}.tm_tool_desc{font-size:11px;color:var(--dsw-alias-label-secondary,#9097a4);line-height:1.4;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
			".tm_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tm_input{box-sizing:border-box;min-width:130px;flex:1;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:7px;background:var(--dsw-alias-bg-base,#17191d);color:inherit;padding:7px 9px;font:inherit;font-size:12px}.tm_code{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#9da8ff}.tm_notice{padding:12px;border-radius:9px;background:color-mix(in srgb,#f59e0b 12%,transparent);font-size:12px}.tm_error{padding:12px;border-radius:9px;background:color-mix(in srgb,#ef4444 12%,transparent);color:#fca5a5;font-size:12px}",
			".tm_filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.tm_chip{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:999px;background:transparent;color:inherit;padding:4px 9px;cursor:pointer;font:inherit;font-size:11px}.tm_chip.active{border-color:#7c8cff;background:color-mix(in srgb,#7c8cff 16%,transparent)}",
			".tm_stats{display:grid;grid-template-columns:repeat(5,minmax(100px,1fr));gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13))}.tm_stat{min-width:0;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.07));border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.15))}.tm_stat_value{font-size:18px;font-weight:700;line-height:1.2}.tm_stat_label{margin-top:3px;font-size:11px;color:var(--dsw-alias-label-secondary,#9097a4)}@media(max-width:720px){.tm_stats{grid-template-columns:repeat(2,minmax(100px,1fr))}}",
			".tm_badge{display:inline-block;margin-left:6px;padding:2px 7px;border:1px solid transparent;border-radius:999px;font-size:10px;font-weight:700;line-height:1.35;letter-spacing:.02em;vertical-align:middle;color:#fff}.tm_badge.off{background:#b42318;border-color:#d92d20;color:#fff}.tm_badge.cold{background:#4338ca;border-color:#6366f1;color:#fff}.tm_badge.live{background:#15803d;border-color:#22c55e;color:#fff}",
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
			".tm_pick{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.1))}.tm_pick:last-child{border-bottom:0}",
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
			return fetch("/tool-manager/api" + path, {
				headers: { "Content-Type": "application/json" },
				...options,
			}).then(async (response) => {
				const body = await response.json().catch(() => ({}));
				if (!response.ok) throw new Error(body.message || "HTTP " + response.status);
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
				name: String(tool.name || "").slice(0, 160),
				description: String(tool.description || "").trim().replace(/\s+/g, " ").slice(0, 600),
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
				"6. 最多生成 32 个组；名称不超过 40 个字符，描述不超过 240 个字符。",
				"7. 只输出一个 JSON 对象，不要输出 Markdown、解释或额外字段。",
				'格式：{"groups":[{"name":"...","description":"...","tools":["exact_name"]}],"ungrouped":["exact_name"]}',
				"候选工具：",
				JSON.stringify(list, null, 2),
			].join("\n");
		}

		function defaultGroupSuggestionPrompt(tools, otherGroupNames) {
			const list = (tools || []).map((tool) => ({
				name: String(tool.name || "").slice(0, 160),
				description: String(tool.description || "").trim().replace(/\s+/g, " ").slice(0, 600),
			}));
			const forbidden = (otherGroupNames && otherGroupNames.length > 0) ? otherGroupNames : ["（无）"];
			return [
				"请根据以下已选择的工具，为一个按需工具组生成名称和描述。",
				"要求：",
				"1. 名称使用简洁自然的中文，概括共同用途，建议 2 到 10 个汉字。",
				"2. 描述使用一句简洁中文，说明该组适合完成什么任务，不要逐个罗列工具。",
				"3. 名称不得与这些其他分组重名：" + forbidden.join("、") + "。",
				"4. 名称不超过 40 个字符，描述不超过 240 个字符。",
				'5. 只输出一个 JSON 对象，不要输出 Markdown、解释或额外字段。格式：{"name":"...","description":"..."}',
				"已选择工具：",
				JSON.stringify(list, null, 2),
			].join("\n");
		}

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
			const [expanded, setExpanded] = react.useState({});
			const [aiConfirm, setAiConfirm] = react.useState(null);
			const [suggestionTimeoutSeconds, setSuggestionTimeoutSeconds] = react.useState("60");
			const [autoGroupTimeoutSeconds, setAutoGroupTimeoutSeconds] = react.useState("120");

			const load = react.useCallback(() => {
				setBusy(true); setError("");
				return api("/snapshot").then((value) => {
					const next = withGroupKeys(value);
					setSnapshot(value); setDraft(next); setModal(null); setAutoPreview(null); setAutoGroupError("");
					setActive((current) => current && value.presets.some((p) => p.id === current) ? current : (value.presets[0] && value.presets[0].id) || "");
				}).catch((e) => setError(String(e.message || e))).finally(() => setBusy(false));
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
				if (!modal && !aiConfirm && !autoPreview) return undefined;
				function onKeyDown(event) {
					if (event.key === "Escape") {
						if (aiConfirm) setAiConfirm(null);
						else if (autoPreview) setAutoPreview(null);
						else if (modal) setModal(null);
					}
				}
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [modal, aiConfirm, autoPreview]);

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
				if (prompt.length > 32000) {
					patchAiConfirm({ error: "提示词不能超过 32000 个字符。" });
					return;
				}
				if (aiConfirm.kind === "auto-group") {
					if (selected.length === 0) {
						patchAiConfirm({ error: "请至少勾选一个工具进行分组。" });
						return;
					}
					if (selected.length > 120) {
						patchAiConfirm({ error: "一次最多勾选 120 个工具进行分组。" });
						return;
					}
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
						setSnapshot(value); setDraft(next); setModal(null);
						setMessage("已保存；运行中 Agent 将从下一个模型步骤应用新策略。");
					})
					.catch((e) => setError(String(e.message || e)))
					.finally(() => setBusy(false));
			}

			const disabled = new Set(preset.policy.disabled || []);
			const grouped = groupedNames(preset);
			const autoGroupCandidates = (preset.tools || []).filter((tool) => !disabled.has(tool.name) && !grouped.has(tool.name));
			const stats = catalogStats(preset);
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
			const aiPromptTooLong = String(aiConfirm && aiConfirm.prompt || "").length > 32000;
			const aiCanConfirm = aiPromptTrimmed.length > 0 && !aiPromptTooLong && (!aiIsAutoGroup || (aiSelected.size > 0 && aiSelected.size <= 120));

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
				const title = (group.name || "").trim() || "未命名分组";
				return h("div", { className: "tm_group", key: key },
					h("div", { className: "tm_group_bar" },
						h("button", { className: "tm_chevron", title: open ? "收起" : "展开", onClick: () => setExpanded((current) => ({ ...current, [key]: !current[key] })) }, open ? "▾" : "▸"),
						h("button", { className: "tm_group_main", onClick: () => setExpanded((current) => ({ ...current, [key]: !current[key] })) },
							h("div", { className: "tm_group_title" }, title, h("span", { className: "tm_badge cold" }, "按需")),
							h("div", { className: "tm_group_sub" }, group.description || "没有描述"),
						),
						h("span", { className: "tm_group_count" }, members.length + " 个工具"),
						h("button", { className: "tm_btn", onClick: () => openEdit(group) }, "编辑"),
						h("button", { className: "tm_btn", onClick: () => deleteGroup(key) }, "删除"),
					),
					open ? h("div", { className: "tm_group_body" }, members.length
						? members.map((tool) => h("div", { className: "tm_member", key: tool.name },
							h("div", { className: "tm_tool_name" }, tool.name, disabled.has(tool.name) ? h("span", { className: "tm_badge off" }, "关闭") : null),
							h("div", { className: "tm_tool_desc", title: tool.description }, tool.description),
						))
						: h("div", { className: "tm_error" }, "无效空组：请编辑并选择至少一个可用工具，或删除该组。"),
					) : null,
				);
			}

			function renderTool(tool) {
				const enabled = !disabled.has(tool.name);
				return h("label", { className: "tm_tool", key: tool.name },
					h("input", { type: "checkbox", checked: enabled, onChange: () => toggleTool(tool.name) }),
					h("span", null,
						h("div", { className: "tm_tool_name" }, tool.name,
							!enabled ? h("span", { className: "tm_badge off" }, "关闭") : h("span", { className: "tm_badge live" }, "常开"),
						),
						h("div", { className: "tm_tool_desc", title: tool.description }, tool.description),
					),
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
									: (aiSelected.size > 120
										? h("div", { className: "tm_error", key: "status" }, "自动分组一次最多处理 120 个工具，当前已勾选 " + aiSelected.size + " 个，请减少勾选。")
										: h("div", { className: "tm_muted", key: "status" }, "已勾选 " + aiSelected.size + " / " + aiCandidates.length + " 个候选工具。自动分组会调用当前默认模型，结果仍可手动修改。")),
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
									!aiPromptTrimmed ? h("div", { className: "tm_error", style: { marginTop: "6px" } }, "提示词不能为空，请输入有效提示词或点击重置为默认。")
										: (aiPromptTooLong ? h("div", { className: "tm_error", style: { marginTop: "6px" } }, "提示词不能超过 32000 个字符，当前共 " + (aiConfirm.prompt || "").length + " 个字符。") : null),
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

			const empty = listedGroups.length === 0 && visibleTools.length === 0;

			return h("div", { className: "tm_root" },
				h("div", { className: "tm_head" },
					h("div", null, h("h2", null, "Agent 工具管理"), h("div", { className: "tm_muted" }, "按每个 Agent 预设开关工具。点「分组」把不常用的收进按需组：平时模型看不到，需要时先查目录再打开。")),
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
							onChange: (event) => { setActive(event.target.value); setQuery(""); setFilter("all"); setModal(null); setAutoPreview(null); setAutoGroupError(""); setExpanded({}); },
						}, draft.presets.map((item) => h("option", { key: item.id, value: item.id }, (item.name || item.id) + " · " + (item.tools || []).length + " 个工具" + (item.isDefault ? " · 默认" : "") + (item.trust === "system" ? "" : " · 用户")))),
					),
				),
				preset.broken ? h("div", { className: "tm_error" }, preset.broken) : null,
				autoGroupError ? h("div", { className: "tm_error" }, autoGroupError) : null,
				h("section", { className: "tm_panel" },
					h("div", { className: "tm_panel_head" },
						h("div", null, h("b", null, "工具目录"), h("div", { className: "tm_muted" }, "关掉后立刻对模型隐藏。按需组默认隐藏，模型要先调用 tool_list 才能使用。")),
						h("div", { className: "tm_row" },
							h("button", { className: "tm_btn", onClick: startAutoGroup, disabled: autoGrouping || autoGroupCandidates.length === 0, title: autoGroupCandidates.length ? "用默认模型对未分组且未关闭的工具进行聚类" : "没有可自动分组的工具" }, autoGrouping ? "自动分组中…" : "自动分组"),
							h("button", { className: "tm_btn", onClick: openCreate, disabled: autoGrouping }, "分组"),
						),
					),
					h("div", { className: "tm_stats" },
						[["工具总量", stats.totalTools], ["分组数量", stats.groupCount], ["未分组工具", stats.ungroupedTools], ["按需工具", stats.onDemandTools], ["已关闭工具", stats.disabledTools]].map(([label, value]) =>
							h("div", { className: "tm_stat", key: label }, h("div", { className: "tm_stat_value" }, value), h("div", { className: "tm_stat_label" }, label)),
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
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
