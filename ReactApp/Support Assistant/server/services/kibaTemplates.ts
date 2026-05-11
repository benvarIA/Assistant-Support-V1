/**
 * Static Kiba template sections extracted from
 * SUP-900 - [SUPPORT] TEMPLATES - Livraison aux clients.docx
 *
 * Each entry: { subject, lines }
 * lines = body paragraphs in order; 'TABLE' is a sentinel replaced by the HTML license table.
 */

export type KibaTemplateSection = {
  subject: string
  lines: string[]
}

type TemplateMap = Record<string, KibaTemplateSection>

const TEMPLATES: TemplateMap = {
  // ── 1. NOUVEAU CLIENT ─────────────────────────────────────────────────────
  'Nouveau client|ON-SITE|EN': {
    subject: 'Welcome to iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent iObeya license purchase order.',
      'Please find attached the license key for iObeya. To access the key, please open the attachment with a text editor (e.g. Notepad) and copy/paste the content into the License section of the administration interface of your platform.',
      'The details of the license are as follows:',
      'TABLE',
      'Maintenance & Support renewal date: {{RENEWAL_DATE}}',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Nouveau client|ON-SITE|FR': {
    subject: 'Bienvenue dans iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Nous vous remercions de votre récente souscription au logiciel iObeya.',
      'Vous trouverez en pièce jointe de ce mail la licence iObeya. Pour information, ouvrez ce fichier avec un éditeur de texte (notepad) et copier/coller le contenu dans la partie licence de l\'administration de votre plateforme.',
      'Voici les infos relatives à votre licence :',
      'TABLE',
      'Date de renouvellement : {{RENEWAL_DATE}}',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Cordialement,',
    ],
  },
  'Nouveau client|ONLINE dédié|EN': {
    subject: 'Welcome to iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent purchase order for subscription to iObeya.',
      'Please find below the details of your new iObeya hosted environment:',
      'TABLE',
      'Subscription renewal date: {{RENEWAL_DATE}}',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Nouveau client|ONLINE dédié|FR': {
    subject: 'Bienvenue dans iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Nous vous remercions de votre récente acquisition du logiciel iObeya.',
      'Veuillez trouver ci-dessous les détails de votre licence relatives à votre plateforme online :',
      'TABLE',
      'Date de renouvellement : {{RENEWAL_DATE}}',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Cordialement,',
    ],
  },
  'Nouveau client|Mutualisée|EN': {
    subject: 'Welcome to iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent purchase order for subscription to iObeya.',
      'Please find below the license details of your new iObeya hosted environment:',
      'TABLE',
      'Subscription renewal date: {{RENEWAL_DATE}}',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Nouveau client|Mutualisée|FR': {
    subject: 'Bienvenue dans iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Merci beaucoup pour votre commande de souscription à iObeya.',
      'Veuillez trouver ci-dessous les détails de la licence de votre nouvel environnement iObeya hébergé :',
      'TABLE',
      'Date de renouvellement de l\'abonnement : {{RENEWAL_DATE}}',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Meilleures salutations,',
    ],
  },

  // ── 2. RENOUVELLEMENT ─────────────────────────────────────────────────────
  'Renouvellement|ON-SITE|EN': {
    subject: 'iObeya Maintenance & Support Renewal – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent purchase order for renewal of Maintenance & Support.',
      'Please find attached the new license key for iObeya. As a reminder, to access the key, please open the attachment with a text editor (e.g. Notepad) and copy/paste the content into the License section of the administration interface of your platform.',
      'The details of the license are as follows:',
      'TABLE',
      'Maintenance & Support renewal date: {{RENEWAL_DATE}}',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Renouvellement|ON-SITE|FR': {
    subject: 'Renouvellement licences iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Merci beaucoup pour votre renouvellement de licence.',
      'Vous trouverez en pièce jointe de ce mail la licence iObeya. Pour rappel ouvrez ce fichier avec un éditeur de texte (notepad) et copier/coller le contenu dans la partie licence de l\'administration de votre plateforme.',
      'Voici les détails de cette licence :',
      'TABLE',
      'Date de renouvellement : {{RENEWAL_DATE}}',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Cordialement,',
    ],
  },
  'Renouvellement|ONLINE dédié|EN': {
    subject: 'iObeya Subscription Renewal – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent purchase order for subscription renewal for iObeya.',
      'Please find below the details of your updated iObeya hosted environment:',
      'TABLE',
      'Subscription renewal date: {{RENEWAL_DATE}}',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Renouvellement|ONLINE dédié|FR': {
    subject: 'Renouvellement iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Merci beaucoup pour votre renouvellement de licence.',
      'Veuillez trouver ci-dessous les détails de la licence que nous avons appliquée sur votre environnement :',
      'TABLE',
      'Date de renouvellement : {{RENEWAL_DATE}}',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Cordialement,',
    ],
  },
  'Renouvellement|Mutualisée|EN': {
    subject: 'iObeya Subscription Renewal – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent purchase order for subscription renewal for iObeya.',
      'Please find below the details of your updated iObeya hosted environment:',
      'TABLE',
      'Subscription renewal date: {{RENEWAL_DATE}}',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Renouvellement|Mutualisée|FR': {
    subject: 'Renouvellement iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Merci beaucoup pour votre renouvellement de licence.',
      'Veuillez trouver ci-dessous les détails de la licence que nous avons appliquée sur votre environnement :',
      'TABLE',
      'Date de renouvellement : {{RENEWAL_DATE}}',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Cordialement,',
    ],
  },

  // ── 3. NOUVELLE SALLE ─────────────────────────────────────────────────────
  'Nouvelle salle|ON-SITE|EN': {
    subject: 'Additional iObeya License(s) – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent purchase order.',
      'Please find attached the new license key for iObeya. As a reminder, to access the key, please open the attachment with a text editor (e.g. Notepad) and copy/paste the content into the License section of the administration interface of your platform.',
      'The details of the license are as follows:',
      'TABLE',
      'Maintenance & Support renewal date: {{RENEWAL_DATE}}',
      'Please make sure to increase the number of rooms in your domain(s) in order to create new rooms and remain within the new license limits.',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Nouvelle salle|ON-SITE|FR': {
    subject: 'Licence iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Merci beaucoup pour votre nouvel achat de licence iObeya.',
      'Vous trouverez en pièce jointe de ce mail le fichier de licence. Pour rappel ouvrez ce fichier avec un éditeur de texte (notepad) et copier/coller le contenu dans la partie licence de l\'administration de votre plateforme.',
      'Voici les détails de cette licence :',
      'TABLE',
      'Date de renouvellement : {{RENEWAL_DATE}}',
      'N\'oubliez pas d\'augmenter le nombre de salles dans votre/vos domaine(s) afin de pouvoir créer de nouvelles salles conformément aux nouvelles limites de licence.',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Cordialement,',
    ],
  },
  'Nouvelle salle|ONLINE dédié|EN': {
    subject: 'Additional iObeya Subscription – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent purchase order for new subscriptions to iObeya.',
      'Please find below the details of your updated iObeya hosted environment:',
      'TABLE',
      'Subscription renewal date: {{RENEWAL_DATE}}',
      'Please make sure to increase the number of rooms in your domain(s) in order to create new rooms and remain within the new license limits.',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Nouvelle salle|ONLINE dédié|FR': {
    subject: 'Nouvelle souscription iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Merci beaucoup pour votre nouvelle souscription à iObeya.',
      'Veuillez trouver ci-dessous les détails de votre environnement hébergé iObeya mis à jour :',
      'TABLE',
      'Date de renouvellement : {{RENEWAL_DATE}}',
      'N\'oubliez pas d\'augmenter le nombre de salles dans votre/vos domaine(s) afin de pouvoir créer de nouvelles salles conformément aux nouvelles limites de licence.',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Cordialement,',
    ],
  },
  'Nouvelle salle|Mutualisée|EN': {
    subject: 'Additional iObeya Subscription(s) – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Hello,',
      'Many thanks for your recent purchase order for new subscriptions to iObeya.',
      'Please find below the license details of your updated iObeya hosted environment:',
      'TABLE',
      'Subscription renewal date: {{RENEWAL_DATE}}',
      'Please do not hesitate to contact us at support@iobeya.com if you have any questions.',
      'Best regards,',
    ],
  },
  'Nouvelle salle|Mutualisée|FR': {
    subject: 'Nouvelle(s) souscription(s) iObeya – {{CUSTOMER_NAME}} ({{QUOTE_NUMBER}})',
    lines: [
      'Bonjour,',
      'Merci beaucoup pour votre commande pour de nouvelles souscriptions à iObeya.',
      'Veuillez trouver ci-dessous les détails de la licence de votre environnement hébergé iObeya mis à jour :',
      'TABLE',
      'Date de renouvellement de l\'abonnement : {{RENEWAL_DATE}}',
      'N\'hésitez pas à nous contacter à support@iobeya.com si vous avez des questions.',
      'Meilleures salutations,',
    ],
  },
}

export function getTemplateSection(
  deliveryType: string,
  clientType: string,
  language: string,
): KibaTemplateSection | null {
  const key = `${deliveryType}|${clientType}|${language}`
  return TEMPLATES[key] ?? null
}

const TABLE_STYLE = 'border-collapse:collapse;margin:8px 0;font-family:sans-serif;font-size:14px;'
const TH_STYLE = 'background:#DCEBFF;color:#1a1a2e;font-weight:700;padding:8px 16px;border:1px solid #D0D7DE;text-align:center;'
const TD_STYLE = 'padding:8px 16px;border:1px solid #D0D7DE;text-align:center;color:#1a1a2e;'

function buildLicenseTable(salles: string, panneaux: string, utilisateurs: string): string {
  return [
    `<table style="${TABLE_STYLE}">`,
    `<thead><tr>`,
    `<th style="${TH_STYLE}">Salles</th>`,
    `<th style="${TH_STYLE}">Panneaux</th>`,
    `<th style="${TH_STYLE}">Utilisateurs</th>`,
    `</tr></thead>`,
    `<tbody><tr>`,
    `<td style="${TD_STYLE}">${escHtml(salles)}</td>`,
    `<td style="${TD_STYLE}">${escHtml(panneaux)}</td>`,
    `<td style="${TD_STYLE}">${escHtml(utilisateurs)}</td>`,
    `</tr></tbody>`,
    `</table>`,
  ].join('')
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export type KibaVars = {
  customerName: string
  quoteNumber: string
  renewalDate: string
  salles: string
  panneaux: string
  utilisateurs: string
}

export function buildHtmlBody(section: KibaTemplateSection, vars: KibaVars): { subject: string; html: string } {
  const fill = (s: string) => {
    let r = s
      .replace(/\{\{CUSTOMER_NAME\}\}/g, escHtml(vars.customerName))
      .replace(/\{\{RENEWAL_DATE\}\}/g, escHtml(vars.renewalDate))
    // If no quote number, remove the whole "({{QUOTE_NUMBER}})" block including surrounding space
    if (vars.quoteNumber) {
      r = r.replace(/\{\{QUOTE_NUMBER\}\}/g, escHtml(vars.quoteNumber))
    } else {
      r = r.replace(/\s*\(\{\{QUOTE_NUMBER\}\}\)/g, '')
    }
    return r
  }

  const subject = fill(section.subject)

  const tableHtml = buildLicenseTable(vars.salles, vars.panneaux, vars.utilisateurs)

  const paragraphs = section.lines.map((line) => {
    if (line === 'TABLE') return tableHtml
    return `<p style="margin:0 0 12px;font-family:sans-serif;font-size:14px;color:#1a1a2e;">${fill(escHtml(line))}</p>`
  })

  const html = [
    '<!DOCTYPE html><html><body style="font-family:sans-serif;font-size:14px;color:#1a1a2e;max-width:600px;margin:0;padding:16px;">',
    ...paragraphs,
    '</body></html>',
  ].join('\n')

  return { subject, html }
}
