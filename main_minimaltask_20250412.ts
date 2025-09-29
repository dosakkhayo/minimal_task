import {
	Plugin,
	TFile,
	PluginSettingTab,
	App,
	Setting,
	Notice,
} from "obsidian";
import moment from "moment";

interface MinimalTaskSettings {
	taskFile: string;
	doneFile: string;
	dateFormat: string;
	timeFormat: string;
}

const DEFAULT_SETTINGS: MinimalTaskSettings = {
	taskFile: "task.md",
	doneFile: "task_done.md",
	dateFormat: "",
	timeFormat: "",
};

export default class MinimalTaskPlugin extends Plugin {
	settings: MinimalTaskSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MinimalTaskSettingTab(this.app, this));

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (file instanceof TFile && file.path === this.settings.taskFile) {
					await this.processTaskFile(file);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", async (_, ctx) => {
				const file = ctx.file;
				if (file && file.path === this.settings.taskFile) {
					await this.processTaskFile(file);
				}
			})
		);
	}

	async processTaskFile(file: TFile) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");

		const remaining: string[] = [];
		const doneTasks: string[] = [];

		const dateFormat = this.settings.dateFormat || "YYYY-MM-DD";
		const timeFormat = this.settings.timeFormat || "HH:mm";

		for (const line of lines) {
			if (/^\s*[-*]\s+\[[xX]\]/.test(line)) {
				const time = moment().format(timeFormat);
				doneTasks.push(`${line.trim()} (${time})`);
			} else {
				remaining.push(line);
			}
		}

		if (doneTasks.length === 0) return;

		await this.app.vault.modify(file, remaining.join("\n"));

		const dateHeader = `### ${moment().format(dateFormat)}`;
		let doneFile = this.app.vault.getAbstractFileByPath(this.settings.doneFile);
		let doneTFile: TFile;

		if (doneFile instanceof TFile) {
			doneTFile = doneFile;
		} else {
			doneTFile = await this.app.vault.create(this.settings.doneFile, "") as TFile;
		}

		const doneContent = await this.app.vault.read(doneTFile);
		const linesInDone = doneContent.split("\n");

		let newContent: string[] = [];
		let inTargetSection = false;
		let sectionFound = false;

		for (let i = 0; i < linesInDone.length; i++) {
			const line = linesInDone[i];

			if (line.trim() === dateHeader) {
				sectionFound = true;
				inTargetSection = true;
				newContent.push(line);
				continue;
			}

			if (inTargetSection && line.startsWith("### ")) {
				newContent.push(...doneTasks);
				inTargetSection = false;
			}

			newContent.push(line);
		}

		if (sectionFound && inTargetSection) {
			newContent.push(...doneTasks);
		} else if (!sectionFound) {
			if (newContent.length > 0) newContent.push("");
			newContent.push(dateHeader, ...doneTasks);
		}

		await this.app.vault.modify(doneTFile, newContent.join("\n").trim());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class MinimalTaskSettingTab extends PluginSettingTab {
	plugin: MinimalTaskPlugin;

	constructor(app: App, plugin: MinimalTaskPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		containerEl.createEl("h2", { text: "minimal task settings" });

		new Setting(containerEl)
			.setName("Task file path")
			.setDesc("Path to the markdown file containing your tasks")
			.addText(text => text
				.setPlaceholder("e.g. task.md")
				.setValue(this.plugin.settings.taskFile)
				.onChange(async value => {
					this.plugin.settings.taskFile = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Done file path")
			.setDesc("Path to the file where checked tasks will be moved")
			.addText(text => text
				.setPlaceholder("e.g. task_done.md")
				.setValue(this.plugin.settings.doneFile)
				.onChange(async value => {
					this.plugin.settings.doneFile = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Date format")
			.setDesc("Leave empty to use default: YYYY-MM-DD")
			.addText(text => text
				.setPlaceholder("YYYY-MM-DD")
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async value => {
					this.plugin.settings.dateFormat = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Time format")
			.setDesc("Leave empty to use default: HH:mm")
			.addText(text => text
				.setPlaceholder("HH:mm")
				.setValue(this.plugin.settings.timeFormat)
				.onChange(async value => {
					this.plugin.settings.timeFormat = value.trim();
					await this.plugin.saveSettings();
				}));
	}
}
