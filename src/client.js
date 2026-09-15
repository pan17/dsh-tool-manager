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
			".tm_tabs{display:flex;gap:7px;flex-wrap:wrap}.tm_tab,.tm_btn{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.08));color:inherit;padding:7px 10px;cursor:pointer;font:inherit;font-size:12px}.tm_tab.active{border-color:#7c8cff;background:color-mix(in srgb,#7c8cff 16%,transparent)}.tm_btn.primary{background:#5367e8;border-color:#5367e8;color:#fff}.tm_btn:disabled{opacity:.5;cursor:not-allowed}",
			".tm_panel{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.24));border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgba(128,128,128,.06));overflow:hidden}",
			".tm_panel_head{padding:13px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.tm_panel_head b{font-size:14px}",
			".tm_tools{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:0}.tm_tool{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.13))}.tm_tool_name{font:600 12px ui-monospace,SFMono-Regular,Consolas,monospace}.tm_tool_desc{font-size:11px;color:var(--dsw-alias-label-secondary,#9097a4);line-height:1.4;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
			".tm_row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.tm_input{box-sizing:border-box;min-width:130px;flex:1;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:7px;background:var(--dsw-alias-bg-base,#17191d);color:inherit;padding:7px 9px;font:inherit;font-size:12px}.tm_code{font:11px ui-monospace,SFMono-Regular,Consolas,monospace;color:#9da8ff}.tm_notice{padding:12px;border-radius:9px;background:color-mix(in srgb,#f59e0b 12%,transparent);font-size:12px}.tm_error{padding:12px;border-radius:9px;background:color-mix(in srgb,#ef4444 12%,transparent);color:#fca5a5;font-size:12px}",
			".tm_filters{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.tm_chip{appearance:none;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:999px;background:transparent;color:inherit;padding:4px 9px;cursor:pointer;font:inherit;font-size:11px}.tm_chip.active{border-color:#7c8cff;background:color-mix(in srgb,#7c8cff 16%,transparent)}",
			".tm_badge{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:999px;font-size:10px;vertical-align:middle}.tm_badge.off{background:color-mix(in srgb,#ef4444 18%,transparent);color:#fca5a5}.tm_badge.cold{background:color-mix(in srgb,#6366f1 18%,transparent);color:#c7d2fe}.tm_badge.live{background:color-mix(in srgb,#22c55e 16%,transparent);color:#86efac}",
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
			".tm_modal_head{padding:16px 16px 12px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.tm_modal_head h3{margin:0;font-size:16px}",
			".tm_modal_body{padding:0 16px 12px;display:flex;flex-direction:column;gap:10px;min-height:0;flex:1}",
			".tm_modal_foot{padding:12px 16px 16px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18))}",
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
		function matchesPattern(value, pattern) {
			if (!pattern.includes("*")) return value === pattern;
			const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*");
			return new RegExp("^" + escaped + "$").test(value);
		}
		function matchingTools(tools, patterns) {
			return (tools || []).filter((tool) => (patterns || []).some((pattern) => matchesPattern(tool.name, pattern)));
		}
		function groupedNames(preset) {
			const names = new Set();
			for (const group of preset.policy.groups || []) {
				for (const tool of matchingTools(preset.tools, group.patterns)) names.add(tool.name);
			}
			return names;
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
			const [expanded, setExpanded] = react.useState({});

			const load = react.useCallback(() => {
				setBusy(true); setError("");
				return api("/snapshot").then((value) => {
					const next = withGroupKeys(value);
					setSnapshot(value); setDraft(next); setModal(null);
					setActive((current) => current && value.presets.some((p) => p.id === current) ? current : (value.presets[0] && value.presets[0].id) || "");
				}).catch((e) => setError(String(e.message || e))).finally(() => setBusy(false));
			}, []);
			react.useEffect(() => { load(); }, [load]);
			react.useEffect(() => {
				if (!modal) return undefined;
				function onKeyDown(event) {
					if (event.key === "Escape") setModal(null);
				}
				window.addEventListener("keydown", onKeyDown);
				return () => window.removeEventListener("keydown", onKeyDown);
			}, [modal]);

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
				});
			}

			function openEdit(group) {
				setModal({
					mode: "edit",
					key: group._key,
					name: group.name || "",
					description: group.description || "",
					patterns: [...(group.patterns || [])],
					query: "",
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

			function confirmModal() {
				if (!modal) return;
				const name = String(modal.name || "").trim().replace(/\s+/g, " ");
				const description = String(modal.description || "").trim();
				const patterns = [...new Set(modal.patterns || [])];
				if (!name) return;
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
				if (created) {
					setFilter("cold");
					setExpanded((current) => ({ ...current, [key]: true }));
				}
			}

			function save() {
				const settings = { presets: {} };
				for (const item of draft.presets) settings.presets[item.id] = policyPayload(item.policy);
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
			const pickerTools = modal ? (preset.tools || []).filter((tool) => matchesQuery(tool, modalNeedle)) : [];
			const visibleSelected = pickerTools.filter((tool) => modalSelected.has(tool.name)).map((tool) => tool.name);
			const canConfirm = !!(modal && String(modal.name || "").trim());
			const listedGroups = showGroups ? visibleGroups : [];

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
						: h("div", { className: "tm_muted" }, "这个组还没有工具。点编辑勾选。"),
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
								h("input", { className: "tm_input", value: modal.name, placeholder: "名称（模型用这个打开）", onChange: (e) => patchModal({ name: e.target.value }) }),
							),
							h("textarea", { className: "tm_input", style: { width: "100%", minHeight: "72px", resize: "vertical" }, value: modal.description, placeholder: "描述（可选）", onChange: (e) => patchModal({ description: e.target.value }) }),
							h("div", { className: "tm_row" },
								h("input", { className: "tm_input", value: modal.query, placeholder: "筛选工具名或描述", onChange: (e) => patchModal({ query: e.target.value }) }),
								h("button", { className: "tm_btn", disabled: pickerTools.length === 0, onClick: () => patchModal({ patterns: [...new Set([...(modal.patterns || []), ...pickerTools.map((tool) => tool.name)])] }) }, "全选当前筛选"),
								h("button", { className: "tm_btn", disabled: visibleSelected.length === 0, onClick: () => patchModal({ patterns: (modal.patterns || []).filter((name) => !visibleSelected.includes(name)) }) }, "清除当前筛选"),
							),
							h("div", { className: "tm_muted" }, "已选 " + modalSelected.size + " 个工具"),
							pickerTools.length
								? h("div", { className: "tm_picker" }, pickerTools.map((tool) => h("label", { className: "tm_pick", key: tool.name },
									h("input", {
										type: "checkbox",
										checked: modalSelected.has(tool.name),
										onChange: (e) => {
											const next = new Set(modal.patterns || []);
											if (e.target.checked) next.add(tool.name); else next.delete(tool.name);
											patchModal({ patterns: [...next] });
										},
									}),
									h("span", null,
										h("div", { className: "tm_tool_name" }, tool.name, disabled.has(tool.name) ? h("span", { className: "tm_badge off" }, "已关闭") : null),
										h("div", { className: "tm_tool_desc", title: tool.description }, tool.description),
									),
								)))
								: h("div", { className: "tm_muted" }, preset.tools.length ? "没有符合筛选的工具。" : "这个 Preset 当前没有可见工具。"),
						),
						h("div", { className: "tm_modal_foot" },
							h("button", { className: "tm_btn", onClick: () => setModal(null) }, "取消"),
							h("button", { className: "tm_btn primary", disabled: !canConfirm, onClick: confirmModal }, "确定"),
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
						h("button", { className: "tm_btn", onClick: load, disabled: busy }, "刷新"),
						h("button", { className: "tm_btn primary", onClick: save, disabled: busy || !draft.writable }, busy ? "处理中…" : "保存"),
					),
				),
				!draft.writable ? h("div", { className: "tm_notice" }, "当前 Settings provider 只读，不能保存。") : null,
				error ? h("div", { className: "tm_error" }, error) : null,
				message ? h("div", { className: "tm_notice" }, message) : null,
				h("div", { className: "tm_tabs" }, draft.presets.map((item) => h("button", { key: item.id, className: "tm_tab" + (item.id === preset.id ? " active" : ""), onClick: () => { setActive(item.id); setQuery(""); setFilter("all"); setModal(null); setExpanded({}); } }, (item.name || item.id) + (item.isDefault ? " · 默认" : "") + (item.trust === "system" ? "" : " · 用户")))),
				preset.broken ? h("div", { className: "tm_error" }, preset.broken) : null,
				h("section", { className: "tm_panel" },
					h("div", { className: "tm_panel_head" },
						h("div", null, h("b", null, "工具目录"), h("div", { className: "tm_muted" }, "关掉后立刻对模型隐藏。按需组默认隐藏，模型要先调用 tool_list 才能使用。")),
						h("button", { className: "tm_btn", onClick: openCreate }, "分组"),
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
