import {
	Plugin,
	TFile,
	PluginSettingTab,
	App,
	Setting,
	Notice,
	FuzzySuggestModal,
} from "obsidian";
import moment from "moment";

interface MinimalTaskSettings {
	taskFile: string;
	doneFile: string;
	dateFormat: string;
	autoOpenTaskFile: boolean;
}

const DEFAULT_SETTINGS: MinimalTaskSettings = {
	taskFile: "task.md",
	doneFile: "task_done.md",
	dateFormat: "",
	autoOpenTaskFile: true,
};

export default class MinimalTaskPlugin extends Plugin {
	settings: MinimalTaskSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new MinimalTaskSettingTab(this.app, this));

		// 명령어 등록
		this.addCommand({
			id: "open-task-file",
			name: "작업 파일 열기",
			callback: () => this.openTaskFile(),
		});
		this.addCommand({
			id: "open-done-file",
			name: "완료 파일 열기",
			callback: () => this.openDoneFile(),
		});

		// 리본 메뉴 버튼 추가
		this.addRibbonIcon("checkmark", "작업 파일 열기", () => {
			this.openTaskFile();
		});
		this.addRibbonIcon("check-circle", "완료 파일 열기", () => {
			this.openDoneFile();
		});

		// 매일 반복 작업의 날짜 체크
		await this.checkRepeatTaskDates();

		// vault가 준비되면 task 파일 자동 열기
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.autoOpenTaskFile) {
				await this.openTaskFile();
			}
		});

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (!(file instanceof TFile)) return;

				if (file.path === this.settings.taskFile) {
					await this.processTaskFile(file);
				}
			})
		);
	}

	async openTaskFile() {
		const taskFile = this.app.vault.getAbstractFileByPath(this.settings.taskFile);
		
		if (taskFile instanceof TFile) {
			// 파일이 이미 열려있는지 확인
			const leaves = this.app.workspace.getLeavesOfType("markdown");
			const targetLeaf = leaves.find(leaf => {
				const view = leaf.view as any;
				return view?.file?.path === this.settings.taskFile;
			});
			if (targetLeaf) {
				// 이미 열려 있으면 해당 탭으로 이동
				this.app.workspace.setActiveLeaf(targetLeaf);
			} else {
				const leaf = this.app.workspace.activeLeaf;
				if (leaf) {
					await leaf.openFile(taskFile);
				}
			}
		} else {
			new Notice(`설정에서 작업 파일을 지정하지 않았습니다.`);
		}
	}

	async processTaskFile(file: TFile) {
		const content = await this.app.vault.read(file);
		const lines = content.split("\n");

		const remaining: string[] = [];
		const doneTasks: string[] = [];
		let inRepeatSection = false;

		const dateFormat = this.settings.dateFormat || "YYYY-MM-DD";

		for (const line of lines) {
			// 섹션 헤더 확인
			if (line.trim() === "### 반복 작업") {
				inRepeatSection = true;
				remaining.push(line);
				continue;
			} else if (line.trim() === "### 일반 작업") {
				inRepeatSection = false;
				remaining.push(line);
				continue;
			} else if (line.startsWith("### ")) {
				// 다른 섹션은 일반 작업으로 처리
				inRepeatSection = false;
				remaining.push(line);
				continue;
			}

			// 체크된 작업 처리
			if (/^\s*[-*]\s+\[[xX]\]/.test(line)) {
				if (inRepeatSection) {
					// 반복 작업 처리 - 날짜를 다음 날짜로 변경
					const taskText = line.replace(/^\s*[-*]\s+\[[xX]\]\s*/, "").replace(/\([^)]+\)\s*$/, "").trim();
					const tomorrow = moment().add(1, 'day').format(dateFormat);
					const newLine = `- [ ] ${taskText} (${tomorrow})`;
					remaining.push(newLine);
					doneTasks.push(line.trim());
				} else {
					// 일반 작업 처리
					doneTasks.push(line.trim());
				}
			} else {
				remaining.push(line);
			}
		}

		if (doneTasks.length === 0) return;

		await this.app.vault.modify(file, remaining.join("\n"));
		await this.appendDoneTasks(doneTasks, dateFormat);
	}

	async appendDoneTasks(tasks: string[], dateFormat: string) {
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
				newContent.push(...tasks);
				inTargetSection = false;
			}

			newContent.push(line);
		}

		if (sectionFound && inTargetSection) {
			newContent.push(...tasks);
		} else if (!sectionFound) {
			if (newContent.length > 0) newContent.push("");
			newContent.push(dateHeader, ...tasks);
		}

		await this.app.vault.modify(doneTFile, newContent.join("\n").trim());
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async checkRepeatTaskDates() {
		const taskFile = this.app.vault.getAbstractFileByPath(this.settings.taskFile);
		if (!(taskFile instanceof TFile)) return;

		const content = await this.app.vault.read(taskFile);
		const lines = content.split("\n");
		const updatedLines: string[] = [];
		let inRepeatSection = false;
		let hasChanges = false;

		const dateFormat = this.settings.dateFormat || "YYYY-MM-DD";
		const today = moment().format(dateFormat);

		for (const line of lines) {
			// 섹션 헤더 확인
			if (line.trim() === "### 반복 작업") {
				inRepeatSection = true;
				updatedLines.push(line);
				continue;
			} else if (line.trim() === "### 일반 작업") {
				inRepeatSection = false;
				updatedLines.push(line);
				continue;
			} else if (line.startsWith("### ")) {
				inRepeatSection = false;
				updatedLines.push(line);
				continue;
			}

			// 반복 작업에서 오늘 날짜가 있는 작업 체크 해제
			if (inRepeatSection && /^\s*[-*]\s+\[[xX]\]/.test(line) && line.includes(`(${today})`)) {
				const taskText = line.replace(/^\s*[-*]\s+\[[xX]\]\s*/, "").replace(/\([^)]+\)\s*$/, "").trim();
				const newLine = `- [ ] ${taskText} (${today})`;
				updatedLines.push(newLine);
				hasChanges = true;
			} else {
				updatedLines.push(line);
			}
		}

		if (hasChanges) {
			await this.app.vault.modify(taskFile, updatedLines.join("\n"));
		}
	}

	async openDoneFile() {
		const doneFile = this.app.vault.getAbstractFileByPath(this.settings.doneFile);
		if (doneFile instanceof TFile) {
			const leaves = this.app.workspace.getLeavesOfType("markdown");
			const targetLeaf = leaves.find(leaf => {
				const view = leaf.view as any;
				return view?.file?.path === this.settings.doneFile;
			});
			if (targetLeaf) {
				this.app.workspace.setActiveLeaf(targetLeaf);
			} else {
				await this.app.workspace.getLeaf().openFile(doneFile);
			}
		} else {
			new Notice(`설정에서 완료 파일을 지정하지 않았습니다.`);
		}
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
		containerEl.createEl("h2", { text: "작업 관리 설정" });

		new Setting(containerEl)
			.setName("작업 파일 경로")
			.setDesc("일반 작업과 반복 작업이 포함된 마크다운 파일의 경로")
			.addText(text => text
				.setPlaceholder("예: task.md")
				.setValue(this.plugin.settings.taskFile)
				.onChange(async value => {
					this.plugin.settings.taskFile = value.trim();
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText("파일 선택")
				.onClick(() => {
					new FileSuggestModal(this.app, this.plugin, async (file) => {
						this.plugin.settings.taskFile = file.path;
						await this.plugin.saveSettings();
						this.display(); // 설정 화면 새로고침
					}).open();
				}));

		new Setting(containerEl)
			.setName("완료 파일 경로")
			.setDesc("완료된 작업이 기록될 파일의 경로")
			.addText(text => text
				.setPlaceholder("예: task_done.md")
				.setValue(this.plugin.settings.doneFile)
				.onChange(async value => {
					this.plugin.settings.doneFile = value.trim();
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText("파일 선택")
				.onClick(() => {
					new FileSuggestModal(this.app, this.plugin, async (file) => {
						this.plugin.settings.doneFile = file.path;
						await this.plugin.saveSettings();
						this.display(); // 설정 화면 새로고침
					}).open();
				}));

		new Setting(containerEl)
			.setName("날짜 형식")
			.setDesc("비워두면 기본값 사용: YYYY-MM-DD")
			.addText(text => text
				.setPlaceholder("YYYY-MM-DD")
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async value => {
					this.plugin.settings.dateFormat = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("작업 파일 자동 열기")
			.setDesc("vault가 준비되면 task 파일을 자동으로 열지 여부")
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoOpenTaskFile)
				.onChange(async value => {
					this.plugin.settings.autoOpenTaskFile = value;
					await this.plugin.saveSettings();
				}));
	}
}

class FileSuggestModal extends FuzzySuggestModal<TFile> {
	plugin: MinimalTaskPlugin;
	onSelect: (file: TFile) => void;

	constructor(app: App, plugin: MinimalTaskPlugin, onSelect: (file: TFile) => void) {
		super(app);
		this.plugin = plugin;
		this.onSelect = onSelect;
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent): void {
		this.onSelect(item);
	}
}