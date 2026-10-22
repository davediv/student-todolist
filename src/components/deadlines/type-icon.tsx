import {
	BookOpen,
	ClipboardList,
	FileText,
	Folder,
	GraduationCap,
} from "lucide-react";
import type { DeadlineInput } from "#/lib/deadlines";

const icons = {
	assignment: ClipboardList,
	exam: GraduationCap,
	project: Folder,
	reading: BookOpen,
	other: FileText,
};
export function TypeIcon({ type }: { type: DeadlineInput["type"] }) {
	const Icon = icons[type];
	return (
		<span className="deadline-type">
			<Icon size={18} aria-hidden="true" />
			{type[0].toUpperCase() + type.slice(1)}
		</span>
	);
}
