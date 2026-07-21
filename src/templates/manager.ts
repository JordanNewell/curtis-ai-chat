import { PromptTemplate, TemplateCategory } from '../types';
import { BUILTIN_TEMPLATES } from './builtins';

export class TemplateManager {
	private customTemplates: Map<string, PromptTemplate> = new Map();

	constructor() {}

	getAllTemplates(): PromptTemplate[] {
		return [...BUILTIN_TEMPLATES, ...this.customTemplates.values()];
	}

	getTemplatesByCategory(category: TemplateCategory): PromptTemplate[] {
		return this.getAllTemplates().filter(t => t.category === category);
	}

	getTemplate(id: string): PromptTemplate | undefined {
		return BUILTIN_TEMPLATES.find(t => t.id === id) || this.customTemplates.get(id);
	}

	getCategories(): string[] {
		const cats = new Set(this.getAllTemplates().map(t => t.category));
		return Array.from(cats);
	}

	addCustomTemplate(template: PromptTemplate): void {
		template.id = `custom-${Date.now()}`;
		this.customTemplates.set(template.id, template);
	}

	updateCustomTemplate(id: string, updates: Partial<PromptTemplate>): boolean {
		const existing = this.customTemplates.get(id);
		if (!existing) return false;
		this.customTemplates.set(id, { ...existing, ...updates });
		return true;
	}

	deleteCustomTemplate(id: string): boolean {
		return this.customTemplates.delete(id);
	}

	searchTemplates(query: string): PromptTemplate[] {
		const q = query.toLowerCase();
		return this.getAllTemplates().filter(t =>
			t.name.toLowerCase().includes(q) ||
			t.description.toLowerCase().includes(q) ||
			t.category.toLowerCase().includes(q)
		);
	}
}
