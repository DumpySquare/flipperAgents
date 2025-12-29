/**
 * F5 License Activation Client
 *
 * Handles offline licensing by calling activate.f5.com SOAP API.
 * This allows the MCP server (with internet) to proxy license activation
 * for BIG-IP devices without internet access.
 *
 * Flow (matches F5 Ansible module exactly):
 * 1. Get dossier from BIG-IP (get_dossier -b <regkey>)
 * 2. Call getLicense with empty EULA - server returns EULA_REQUIRED state + EULA text
 * 3. Call getLicense again with EULA - server returns LICENSE_RETURNED state + license
 * 4. Install license on BIG-IP
 *
 * Reference: https://github.com/F5Networks/f5-ansible bigip_device_license.py
 */

import { log } from './logger.js';

const LICENSE_SERVER = 'activate.f5.com';
const ACTIVATION_ENDPOINT = `https://${LICENSE_SERVER}/license/services/urn:com.f5.license.v5b.ActivationService`;

export interface LicenseActivationParams {
  dossier: string;
  eula?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  jobTitle?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface ActivationResult {
  success: boolean;
  license?: string;
  eula?: string;
  eulaRequired?: boolean;
  state?: string;
  error?: string;
}

/**
 * Build SOAP envelope for getLicense call
 * Matches F5 Ansible module format exactly
 */
function buildLicenseEnvelope(params: LicenseActivationParams): string {
  const {
    dossier,
    eula = '',
    email = '',
    firstName = '',
    lastName = '',
    company = '',
    phone = '',
    jobTitle = '',
    address = '',
    city = '',
    state = '',
    postalCode = '',
    country = '',
  } = params;

  // Match exact format from F5 Ansible module
  return `<?xml version="1.0" encoding="UTF-8"?>
<SOAP-ENV:Envelope xmlns:ns3="http://www.w3.org/2001/XMLSchema"
                   xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"
                   xmlns:ns0="http://schemas.xmlsoap.org/soap/encoding/"
                   xmlns:ns1="https://${LICENSE_SERVER}/license/services/urn:com.f5.license.v5b.ActivationService"
                   xmlns:ns2="http://schemas.xmlsoap.org/soap/envelope/"
                   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                   xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
                   SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <SOAP-ENV:Header/>
  <ns2:Body>
    <ns1:getLicense>
      <dossier xsi:type="ns3:string">${dossier}</dossier>
      <eula xsi:type="ns3:string">${eula}</eula>
      <email xsi:type="ns3:string">${email}</email>
      <firstName xsi:type="ns3:string">${firstName}</firstName>
      <lastName xsi:type="ns3:string">${lastName}</lastName>
      <companyName xsi:type="ns3:string">${company}</companyName>
      <phone xsi:type="ns3:string">${phone}</phone>
      <jobTitle xsi:type="ns3:string">${jobTitle}</jobTitle>
      <address xsi:type="ns3:string">${address}</address>
      <city xsi:type="ns3:string">${city}</city>
      <stateProvince xsi:type="ns3:string">${state}</stateProvince>
      <postalCode xsi:type="ns3:string">${postalCode}</postalCode>
      <country xsi:type="ns3:string">${country}</country>
    </ns1:getLicense>
  </ns2:Body>
</SOAP-ENV:Envelope>`;
}

/**
 * Extract text content from XML element
 */
function extractXmlValue(xml: string, tag: string): string | null {
  // Handle both <tag>value</tag> and <tag xsi:type="...">value</tag>
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * Check if SOAP response contains a fault
 */
function extractSoapFault(xml: string): string | null {
  const faultString = extractXmlValue(xml, 'faultstring');
  if (faultString) {
    return faultString;
  }
  const faultMessage = extractXmlValue(xml, 'message');
  if (faultMessage && xml.includes('Fault')) {
    return faultMessage;
  }
  return null;
}

/**
 * Activate license with F5 license server
 *
 * Mimics F5 Ansible module flow exactly:
 * 1. First call with empty EULA returns state=EULA_REQUIRED + eula text
 * 2. Second call with EULA returns state=LICENSE_RETURNED + license text
 */
export async function activateLicense(params: LicenseActivationParams): Promise<ActivationResult> {
  const envelope = buildLicenseEnvelope(params);

  log.info('Calling F5 license server', {
    server: LICENSE_SERVER,
    hasEula: !!params.eula,
    dossierLength: params.dossier.length,
  });
  log.debug('SOAP envelope', { envelope: envelope.substring(0, 500) });

  try {
    const response = await fetch(ACTIVATION_ENDPOINT, {
      method: 'POST',
      headers: {
        'SOAPAction': '""',
        'Content-Type': 'text/xml; charset=utf-8',
      },
      body: envelope,
    });

    const responseText = await response.text();
    log.debug('Response received', {
      status: response.status,
      length: responseText.length,
      body: responseText.substring(0, 2000),
      hasLicenseTag: responseText.includes('<license'),
      licenseSnippet: responseText.includes('<license') ? responseText.substring(responseText.indexOf('<license'), responseText.indexOf('<license') + 200) : 'none',
    });

    // Check for HTTP error
    if (!response.ok) {
      const fault = extractSoapFault(responseText);
      return {
        success: false,
        error: fault || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    // Check for SOAP fault
    const fault = extractSoapFault(responseText);
    if (fault) {
      return { success: false, error: fault };
    }

    // Extract state from response - may be nested in multiRef element
    let state = extractXmlValue(responseText, 'state');

    // If no state found, check if we have EULA (indicates EULA_REQUIRED)
    if (!state) {
      const hasEula = responseText.includes('<eula') && responseText.includes('END USER LICENSE AGREEMENT');
      // License text starts with "#!" or "Auth vers"
      const hasLicense = responseText.includes('<license') && (responseText.includes('#!') || responseText.includes('Auth vers'));
      log.debug('State detection', { hasEula, hasLicense, responseLength: responseText.length });
      if (hasLicense) {
        state = 'LICENSE_RETURNED';
      } else if (hasEula) {
        state = 'EULA_REQUIRED';
      }
    }

    log.info('License server response state', { state });

    if (state === 'EULA_REQUIRED') {
      // Extract EULA text
      const eula = extractXmlValue(responseText, 'eula');
      if (!eula) {
        return { success: false, error: 'EULA_REQUIRED but no EULA in response' };
      }
      return {
        success: false,
        eulaRequired: true,
        eula,
        state,
      };
    }

    if (state === 'LICENSE_RETURNED') {
      // Extract license text
      let license = extractXmlValue(responseText, 'license');
      if (!license) {
        return { success: false, error: 'LICENSE_RETURNED but no license in response' };
      }

      // Decode XML entities
      license = license
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");

      log.info('License activation successful', { licenseLength: license.length });
      return { success: true, license, state };
    }

    if (state === 'EMAIL_REQUIRED') {
      return { success: false, error: 'Email address required for activation', state };
    }

    if (state === 'CONTACT_INFO_REQUIRED') {
      return { success: false, error: 'Contact information required for activation', state };
    }

    // Unknown state
    return {
      success: false,
      error: `Unexpected license server state: ${state || 'unknown'}`,
      state: state || undefined,
    };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error('Failed to contact license server', { error: message });
    return {
      success: false,
      error: `Failed to contact license server: ${message}`,
    };
  }
}

/**
 * Complete license activation flow (handles EULA automatically)
 *
 * This is the main entry point - it handles the full EULA negotiation:
 * 1. Call getLicense with empty EULA
 * 2. If EULA_REQUIRED, call again with the returned EULA
 * 3. Return the license text
 */
export async function activateLicenseWithEula(params: LicenseActivationParams): Promise<ActivationResult> {
  // First call - get EULA
  log.info('Starting license activation flow');
  const firstResult = await activateLicense({ ...params, eula: '' });

  if (firstResult.success) {
    // Unexpected - got license on first try
    return firstResult;
  }

  if (!firstResult.eulaRequired || !firstResult.eula) {
    // Error or unexpected state
    return firstResult;
  }

  // Second call - submit with EULA
  log.info('EULA received, submitting license request with EULA acceptance');
  const secondResult = await activateLicense({ ...params, eula: firstResult.eula });

  return secondResult;
}

// Keep old function name for backward compatibility
export async function getEula(dossier: string): Promise<{ eula: string } | { error: string }> {
  const result = await activateLicense({ dossier, eula: '' });
  if (result.eulaRequired && result.eula) {
    return { eula: result.eula };
  }
  return { error: result.error || 'Failed to get EULA' };
}
