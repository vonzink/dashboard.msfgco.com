-- Seed data for processing_links table
-- Run after migration 019_processing_links.sql

-- VOE Links (10)
INSERT INTO processing_links (section_type, name, url, icon, sort_order) VALUES
('voe', 'The Work Number', 'https://theworknumber.com/', 'fa-building', 1),
('voe', 'The Work Number (Employer Search)', 'https://secure.theworknumber.talx.com/twneeer/PreAuthenticated/FindEmployer.aspx?ReturnUrl=%2ftwneeer%2f', 'fa-search', 2),
('voe', 'T & C Verify', 'https://verify.thomas-and-company.com/login/', 'fa-user-check', 3),
('voe', 'CCC Verify', 'https://www.cccverify.com/', 'fa-check-circle', 4),
('voe', 'Truework', 'https://www.truework.com/', 'fa-briefcase', 5),
('voe', 'Experian Verify', 'https://www.experian.com/employer-services/products/verification-fulfillment/experian-verify', 'fa-id-badge', 6),
('voe', 'Verifent', 'https://www.verifent.com/', 'fa-clipboard-check', 7),
('voe', 'VerifyToday', 'https://verifytoday.com/', 'fa-calendar-check', 8),
('voe', 'VeriSafeJobs', 'https://myaccount.verisafejobs.com/signin', 'fa-shield-alt', 9),
('voe', 'Vault Verify', 'https://www.vaultverify.com/', 'fa-lock', 10);

-- AMC Links (17)
INSERT INTO processing_links (section_type, name, url, icon, sort_order) VALUES
('amc', 'Nations Valuations', 'https://uorder.nationsvs.com/Account/LogOn?ReturnUrl=%2f', 'fa-flag-usa', 1),
('amc', 'Appraisal Nation', 'https://appraisalnation.appraisalscope.com/login#Dashboard-Pending', 'fa-home', 2),
('amc', 'First Look Appraisals', 'https://www.firstlookappraisals.com/', 'fa-eye', 3),
('amc', 'Axis (VMP)', 'https://axis.vmpclient.com/SignIn.aspx', 'fa-chart-line', 4),
('amc', 'ACT Appraisalscope', 'https://act.appraisalscope.com/client/clientdashboard#Dashboard-Pending', 'fa-tasks', 5),
('amc', 'Mueller Reports', 'https://www2.muellerreports.com/', 'fa-file-alt', 6),
('amc', 'UCDP Login', 'https://www.uniformdataportal.com/VAMAuthUtility/login.aspx', 'fa-database', 7),
('amc', 'CA-USA Client Portal', 'https://clients.ca-usa.com/Account/LogOn?ReturnUrl=%2f', 'fa-globe', 8),
('amc', 'EPM (VMP)', 'https://epmequityprimemortgage.vmpclient.com/SignIn.aspx', 'fa-building', 9),
('amc', 'Plains Commerce Bank (VMP)', 'https://plainscommercebank.vmpclient.com/SignIn.aspx', 'fa-university', 10),
('amc', 'Class Appraisalscope', 'https://class.appraisalscope.com/signin/', 'fa-clipboard-list', 11),
('amc', 'Mutual of Omaha (VMP)', 'https://mutualofomahamortgagewholesale.vmpclient.com/SignIn.aspx', 'fa-handshake', 12),
('amc', 'Xpanse', 'https://xpanseinc.us.auth0.com/login', 'fa-expand-arrows-alt', 13),
('amc', 'Clear Capital', 'https://www.clearcapital.com/', 'fa-gem', 14),
('amc', 'Orion Lending (VMP)', 'https://orionlending.vmpclient.com/SignIn.aspx', 'fa-star', 15),
('amc', 'Appraisal Links', 'https://appraisallinks.appraisalscope.com/signin/', 'fa-link', 16),
('amc', 'Class Valuation', 'https://ids.classvaluation.com/Account/Login', 'fa-balance-scale', 17);

-- Payoffs Links (7)
INSERT INTO processing_links (section_type, name, url, icon, sort_order) VALUES
('payoffs', 'Mr. Cooper', 'https://www.mrcooper.com/broker_agent_services/payoff_quote_request', 'fa-user-tie', 1),
('payoffs', 'Provident Funding', 'https://www.provident.com/payoffstatement/order', 'fa-money-check-alt', 2),
('payoffs', 'EPM Servicing', 'https://epm.servicingdivision.com/ThirdPartyPayoff', 'fa-building', 3),
('payoffs', 'Essex Mortgage', 'https://www.essexmortgage.com/myaccount', 'fa-home', 4),
('payoffs', 'Pennymac', 'https://servicingpartners.pennymac.com/', 'fa-coins', 5),
('payoffs', 'Lakeview Loan Servicing', 'https://lakeviewloanservicing.myloancare.com/web/help-center/tppform', 'fa-water', 6),
('payoffs', 'MyServiceMac', 'https://myservicemac.com/#step-1', 'fa-laptop', 7);

-- Insurance Links (10)
INSERT INTO processing_links (section_type, name, url, icon, sort_order) VALUES
('insurance', 'USAA Business Access', 'https://www.partners.usaa.com/partner_pas/hub.jsp', 'fa-shield-alt', 1),
('insurance', 'GEICO Mortgagee Change', 'https://propertysales.geico.com/MCRForm/Home/Index', 'fa-car', 2),
('insurance', 'AmFam B2B Lender Portal', 'https://b2b.amfam.com/siteminderagent/forms/b2b-login.fcc', 'fa-users', 3),
('insurance', 'Nationwide Third-party', 'https://www.nationwide.com/personal/contact/third-party/', 'fa-globe-americas', 4),
('insurance', 'State Farm B2B Portal', 'https://b2b.statefarm.com/b2b-content', 'fa-hands-helping', 5),
('insurance', 'Anderson Ban Insurance', 'https://www.andersonbaninsurance.com/request-a-certificate-of-insurance', 'fa-file-certificate', 6),
('insurance', 'USAA Coverage Verification', 'https://www.usaa.com/support/insurance-business-services', 'fa-check-double', 7),
('insurance', 'USAA Dwelling Inquiry', 'https://www.usaa.com/support/insurance-business-services/property', 'fa-house-damage', 8),
('insurance', 'CCIG', 'https://thinkccig.com/', 'fa-umbrella', 9),
('insurance', 'Goosehead LenderDock', 'https://more.lenderdock.com/goosehead/?t=w', 'fa-key', 10);
