import { PdfDocument, PdfFlow } from '@proctira/pdf-lite';

export interface IdCardStudent {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  nationalId: string | null;
}

export function renderStudentIdCardPdf(student: IdCardStudent): Buffer {
  const doc = new PdfDocument({
    title: `Student ID — ${student.firstName} ${student.lastName}`,
    author: 'ProctiraERP Students',
  });
  const flow = new PdfFlow(doc, {
    header: 'ProctiraERP · Student identity card',
    footer: 'Official student ID — Page {page} of {pages}',
  });
  flow.heading(`${student.firstName} ${student.lastName}`);
  flow.paragraph('Carry this card while on campus. It identifies the enrolled student.');
  flow.spacer(8);
  flow.keyValue('Student ID', student.id);
  flow.keyValue('Date of birth', student.dateOfBirth);
  flow.keyValue('Gender', student.gender);
  flow.keyValue('National ID', student.nationalId ?? '—');
  flow.horizontalRule();
  flow.paragraph(`Issued ${new Date().toISOString().slice(0, 10)}.`);
  return flow.finish();
}
