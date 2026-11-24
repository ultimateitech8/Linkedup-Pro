// These expressions are built from fixed aliases and parameter positions in the calling query.
export function managesCompany(company: string, member: string) {
  return `EXISTS(SELECT 1 FROM professional_companies company_owner WHERE company_owner.id=${company} AND (
    company_owner.owner_id=${member} OR EXISTS(SELECT 1 FROM company_members company_admin
      WHERE company_admin.company_id=company_owner.id AND company_admin.user_id=${member} AND company_admin.role='admin')
  ))`;
}

export function managesJob(member: string) {
  return `((j.company_id IS NULL AND j.owner_id=${member}) OR ${managesCompany('j.company_id', member)})`;
}
