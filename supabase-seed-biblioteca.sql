-- =============================================================
-- ConcurFlow — Seed da Biblioteca: principais concursos do Brasil
-- Insere os concursos mais buscados como PRÉ-EDITAL (sem data, sem
-- matérias). As matérias/tópicos entram quando alguém subir o PDF do
-- edital (fluxo de extração por IA já existente).
--
-- Idempotente: não duplica concursos cujo nome já existe (case-insensitive).
-- Pode rodar mais de uma vez sem problema. Rode no SQL Editor do Supabase.
-- =============================================================

insert into public.exams (name, organization, description)
select v.name, v.org, v.descr
from (values
  -- ===== Federais — carreiras nacionais =====
  ('Concurso Nacional Unificado (CNU)', 'Ministério da Gestão e Inovação', 'O "Enem dos Concursos" — vários órgãos federais em uma prova'),
  ('Receita Federal',                   'Ministério da Fazenda',           'Auditor-Fiscal e Analista-Tributário'),
  ('Polícia Federal',                   'Ministério da Justiça',           'Agente, Escrivão, Delegado e Perito'),
  ('Polícia Rodoviária Federal (PRF)',  'Ministério da Justiça',           'Policial Rodoviário Federal'),
  ('Instituto Nacional do Seguro Social (INSS)', 'INSS',                    'Técnico e Analista do Seguro Social'),
  ('IBGE',                              'Instituto Brasileiro de Geografia e Estatística', 'Agente Censitário, Recenseador e Analista'),
  ('Tribunal de Contas da União (TCU)', 'TCU',                             'Auditor Federal de Controle Externo'),
  ('Controladoria-Geral da União (CGU)','CGU',                             'Auditor e Técnico Federal de Finanças e Controle'),
  ('Banco Central (BACEN)',             'Banco Central do Brasil',         'Analista do Banco Central'),
  ('Ministério Público da União (MPU)', 'MPU',                             'Técnico e Analista do MPU'),
  ('Advocacia-Geral da União (AGU)',    'AGU',                             'Advogado da União, Procurador e Administrador'),
  ('Câmara dos Deputados',              'Câmara dos Deputados',            'Analista e Técnico Legislativo'),
  ('Senado Federal',                    'Senado Federal',                  'Analista e Técnico Legislativo'),
  ('Defensoria Pública da União (DPU)', 'DPU',                             'Técnico e Analista'),
  ('Correios',                          'Empresa Brasileira de Correios',  'Carteiro e Agente dos Correios'),

  -- ===== Agências reguladoras / autarquias =====
  ('ANVISA',                            'Agência Nacional de Vigilância Sanitária', 'Técnico e Especialista em Regulação'),
  ('ANATEL',                            'Agência Nacional de Telecomunicações',     'Especialista e Técnico em Regulação'),
  ('IBAMA',                             'Instituto Brasileiro do Meio Ambiente',    'Analista e Técnico Ambiental'),
  ('ICMBio',                            'Instituto Chico Mendes',                   'Analista e Técnico Ambiental'),
  ('Embrapa',                           'Empresa Brasileira de Pesquisa Agropecuária', 'Analista e Técnico'),

  -- ===== Bancos e estatais =====
  ('Banco do Brasil',                   'Banco do Brasil',                 'Escriturário e Agente de Tecnologia'),
  ('Caixa Econômica Federal',           'Caixa Econômica Federal',         'Técnico Bancário'),
  ('Banco do Nordeste (BNB)',           'Banco do Nordeste',               'Analista Bancário'),
  ('BNDES',                             'Banco Nacional de Desenvolvimento', 'Técnico e Profissional'),
  ('Petrobras',                         'Petrobras',                       'Técnico e Profissional de Petróleo'),
  ('Eletrobras',                        'Eletrobras',                      'Áreas diversas'),
  ('Serpro',                            'Serpro',                          'Analista e Técnico de TI'),
  ('Dataprev',                          'Dataprev',                        'Analista e Técnico'),

  -- ===== Judiciário (genéricos por ramo) =====
  ('Tribunal de Justiça (TJ)',          'Tribunais de Justiça Estaduais',  'Escrevente, Analista e Técnico Judiciário'),
  ('Tribunal Regional Federal (TRF)',   'Justiça Federal',                 'Analista e Técnico Judiciário'),
  ('Tribunal Regional do Trabalho (TRT)','Justiça do Trabalho',            'Analista e Técnico Judiciário'),
  ('Tribunal Regional Eleitoral (TRE)', 'Justiça Eleitoral',               'Analista e Técnico Judiciário'),
  ('Superior Tribunal de Justiça (STJ)','STJ',                             'Analista e Técnico Judiciário'),
  ('Tribunal Superior do Trabalho (TST)','TST',                            'Analista e Técnico Judiciário'),
  ('Ministério Público Estadual (MP)',  'Ministérios Públicos Estaduais',  'Analista e Técnico do MP'),

  -- ===== Segurança pública (estadual) =====
  ('Polícia Civil (PC)',                'Polícias Civis Estaduais',        'Investigador, Escrivão e Delegado'),
  ('Polícia Militar (PM)',              'Polícias Militares Estaduais',    'Soldado e Oficial'),
  ('Polícia Penal',                     'Administração Penitenciária',     'Policial Penal'),
  ('Corpo de Bombeiros Militar (CBM)',  'Corpos de Bombeiros Estaduais',   'Soldado e Oficial'),

  -- ===== Fazendário / controle estadual / municipal =====
  ('SEFAZ (Auditor Fiscal)',            'Secretarias Estaduais de Fazenda','Auditor Fiscal da Receita Estadual'),
  ('Tribunal de Contas do Estado (TCE)','Tribunais de Contas Estaduais',   'Auditor, Analista e Técnico de Controle Externo'),
  ('DETRAN',                            'Departamentos Estaduais de Trânsito', 'Assistente e Analista'),
  ('Prefeitura Municipal',              'Prefeituras',                     'Cargos diversos — nível médio e superior'),
  ('Câmara Municipal',                  'Câmaras Municipais',              'Analista e Técnico Legislativo')
) as v(name, org, descr)
where not exists (
  select 1 from public.exams e where lower(e.name) = lower(v.name)
);
