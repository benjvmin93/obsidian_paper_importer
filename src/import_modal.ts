import { App, Modal, Notice, normalizePath, requestUrl } from "obsidian";

import { searchPaper } from "./arxiv";
import noteTemplate from "./note_template";
import { PaperImporterPluginSettings } from "./setting_tab";

export class ImportModal extends Modal {
	settings: PaperImporterPluginSettings;

	constructor(app: App, settings: PaperImporterPluginSettings) {
		super(app);

		this.settings = settings;
	}

	onOpen() {
		let { contentEl } = this;

		contentEl.createEl("h4", {
			text: "Import Paper from arXiv",
		});
		contentEl.createEl("p", {
			text: "Enter the arXiv ID or URL of the paper you want to import. Press Enter to confirm.",
			attr: { style: "margin-bottom: 20px; color: gray" },
		});
		contentEl.createEl("input", {
			attr: {
				type: "text",
				style: "width: 100%;",
				id: "paper-title-input",
			},
		});

		contentEl.addEventListener("keypress", async (e) => {
			if (e.key === "Enter") {
				new Notice("Importing paper...");

				const paper = (
					contentEl.querySelector(
						"#paper-title-input"
					) as HTMLInputElement
				).value;

				let arxivId: string;
				try {
					arxivId = this.extractArxivId(paper);
				} catch (error) {
					new Notice(error.message);
					return;
				}

				try {
					const [notePath, _] = await this.searchAndImportPaper(
						arxivId
					);
					await this.app.workspace.openLinkText(notePath, "", true);
				} catch (error) {
					new Notice(error.message);
				}

				new Notice("Paper imported!");

				this.close();
			}
		});
	}

	onClose() {
		let { contentEl } = this;
		contentEl.empty();
	}

	async searchAndImportPaper(arxivId: string): Promise<[string, string]> {
		const paper = await searchPaper(arxivId);

		const pdfFolder = normalizePath(this.settings.pdfFolder);

		let pdfFolderPath = this.app.vault.getFolderByPath(pdfFolder)!;
		if (!pdfFolderPath) {
			pdfFolderPath = await this.app.vault.createFolder(pdfFolder);
		}

		const pdfFilename = this.sanitizeFilename(
			`${paper.title} (${paper.paperId}).pdf`
		);
		const pdfPath = normalizePath(`${pdfFolderPath.path}/${pdfFilename}`);

		const response = await requestUrl(paper.pdfUrl);
		await this.app.vault.adapter.writeBinary(pdfPath, response.arrayBuffer);

		const noteFolder = normalizePath(this.settings.noteFolder);

		let noteFolderPath = this.app.vault.getFolderByPath(noteFolder)!;
		if (!noteFolderPath) {
			noteFolderPath = await this.app.vault.createFolder(noteFolder);
		}

		const noteFilename = this.sanitizeFilename(
			`${paper.title} (${paper.paperId}).md`
		);
		const notePath = normalizePath(
			`${noteFolderPath.path}/${noteFilename}`
		);

		const authors = paper.authors.map(author => {
			return `- ${author}`;
		}).join("\n");

		const match = paper.date.match("[0-9]{4}-[0-9]{2}-[0-9]{2}");
		let year = "";
		let md = "";
		if (match != null) {
			const date = new Date(match[0]);
			year = date.getFullYear().toString();
			md = date.getMonth().toString() + "." + date.getDay().toString();
		} else {
			year = paper.date;
			md = paper.date;
		}

		const noteContent = noteTemplate
			.replace(/{{\s*paper_id\s*}}/g, paper.paperId)
			.replace(/{{\s*title\s*}}/g, `"${paper.title}"`)
			.replace(/{{\s*authors\s*}}/g, `\n${authors}`)
			.replace(/{{\s*year\s*}}/g, year)
			.replace(/{{\s*date\s*}}/g, md)
			.replace(/{{\s*abstract\s*}}/g, `"${paper.abstract}"`)
			.replace(/{{\s*comments\s*}}/g, `"${paper.comments}"`)
			.replace(/{{\s*pdf_link\s*}}/g, `"[[${pdfPath}]]"`);

		await this.app.vault.adapter.write(notePath, noteContent);

		return [notePath, pdfPath];
	}

	extractArxivId(text: string): string {
		// Match against arXiv:xxxx.xxxx or arxiv:xxxx.xxxxx
		const arxivIdPattern = /^arXiv:(\d{4}\.\d{4,5})$/;
		const match = text.match(arxivIdPattern);
		if (match) {
			return match[match.length - 1];
		}

		// Match against xxxx.xxxx or xxxx.xxxxx
		const idPattern = /^\d{4}\.\d{4,5}$/;
		const idMatch = text.match(idPattern);
		if (idMatch) {
			return idMatch[0];
		}

		// Match against arxiv.org/abs/xxxx.xxxx or arxiv.org/abs/xxxx.xxxxx or
		// arxiv.org/pdf/xxxx.xxxx or arxiv.org/pdf/xxxx.xxxxx
		const urlPattern =
			/^(https?:\/\/)?(www\.)?arxiv\.org\/(abs|pdf)\/(\d{4}\.\d{4,5})$/;
		const urlMatch = text.match(urlPattern);
		if (urlMatch) {
			return urlMatch[urlMatch.length - 1];
		}

		throw new Error("Invalid arXiv ID or URL");
	}

	sanitizeFilename(filename: string): string {
		return filename
			.replace(/[/\\?%*:|"<>]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}
}
