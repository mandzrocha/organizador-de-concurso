-- =============================================================
-- ConcurFlow — Seed da Biblioteca: principais concursos do Brasil
-- Nacionais + Forças Armadas (militar) + por estado (TJ, MP, PC, PM,
-- Bombeiros, Polícia Penal, SEFAZ, TCE de cada UF).
-- Todos como PRÉ-EDITAL (sem data, sem matérias — entram via upload do PDF).
-- Idempotente: não duplica por nome (case-insensitive). Rode no SQL Editor.
-- =============================================================

-- 1) Colunas de filtro/detalhe
alter table public.exams add column if not exists uf            text;
alter table public.exams add column if not exists category      text;
alter table public.exams add column if not exists banca         text;
alter table public.exams add column if not exists edital_status text;

-- 2) Concursos NACIONAIS (uf nulo) ---------------------------------
-- Lista nacional em CTE: UPDATE (categoriza quem já existe) + INSERT
-- (cria os que faltam). Sem tabela temporária — evita o aviso de RLS.
with nacionais(name, org, descr, category) as (
  values
  ('Concurso Nacional Unificado (CNU)', 'Ministério da Gestão e Inovação', 'O "Enem dos Concursos" — vários órgãos federais', 'federal'),
  ('Receita Federal',                   'Ministério da Fazenda',           'Auditor-Fiscal e Analista-Tributário', 'fiscal'),
  ('Polícia Federal',                   'Ministério da Justiça',           'Agente, Escrivão, Delegado e Perito', 'seguranca'),
  ('Polícia Rodoviária Federal (PRF)',  'Ministério da Justiça',           'Policial Rodoviário Federal', 'seguranca'),
  ('Instituto Nacional do Seguro Social (INSS)', 'INSS',                    'Técnico e Analista do Seguro Social', 'federal'),
  ('IBGE',                              'Instituto Brasileiro de Geografia e Estatística', 'Agente Censitário, Recenseador e Analista', 'federal'),
  ('Tribunal de Contas da União (TCU)', 'TCU',                             'Auditor Federal de Controle Externo', 'controle'),
  ('Controladoria-Geral da União (CGU)','CGU',                             'Auditor e Técnico Federal de Finanças e Controle', 'controle'),
  ('Banco Central (BACEN)',             'Banco Central do Brasil',         'Analista do Banco Central', 'federal'),
  ('Ministério Público da União (MPU)', 'MPU',                             'Técnico e Analista do MPU', 'tribunais'),
  ('Advocacia-Geral da União (AGU)',    'AGU',                             'Advogado da União, Procurador e Administrador', 'tribunais'),
  ('Câmara dos Deputados',              'Câmara dos Deputados',            'Analista e Técnico Legislativo', 'legislativo'),
  ('Senado Federal',                    'Senado Federal',                  'Analista e Técnico Legislativo', 'legislativo'),
  ('Defensoria Pública da União (DPU)', 'DPU',                             'Técnico e Analista', 'tribunais'),
  ('Correios',                          'Empresa Brasileira de Correios',  'Carteiro e Agente dos Correios', 'bancario'),
  ('ANVISA',                            'Agência Nacional de Vigilância Sanitária', 'Técnico e Especialista em Regulação', 'agencias'),
  ('ANATEL',                            'Agência Nacional de Telecomunicações',     'Especialista e Técnico em Regulação', 'agencias'),
  ('IBAMA',                             'Instituto Brasileiro do Meio Ambiente',    'Analista e Técnico Ambiental', 'agencias'),
  ('ICMBio',                            'Instituto Chico Mendes',                   'Analista e Técnico Ambiental', 'agencias'),
  ('Embrapa',                           'Empresa Brasileira de Pesquisa Agropecuária', 'Analista e Técnico', 'agencias'),
  ('Banco do Brasil',                   'Banco do Brasil',                 'Escriturário e Agente de Tecnologia', 'bancario'),
  ('Caixa Econômica Federal',           'Caixa Econômica Federal',         'Técnico Bancário', 'bancario'),
  ('Banco do Nordeste (BNB)',           'Banco do Nordeste',               'Analista Bancário', 'bancario'),
  ('BNDES',                             'Banco Nacional de Desenvolvimento', 'Técnico e Profissional', 'bancario'),
  ('Petrobras',                         'Petrobras',                       'Técnico e Profissional de Petróleo', 'bancario'),
  ('Eletrobras',                        'Eletrobras',                      'Áreas diversas', 'bancario'),
  ('Serpro',                            'Serpro',                          'Analista e Técnico de TI', 'bancario'),
  ('Dataprev',                          'Dataprev',                        'Analista e Técnico', 'bancario'),
  ('Tribunal Regional Federal (TRF)',   'Justiça Federal',                 'Analista e Técnico Judiciário', 'tribunais'),
  ('Tribunal Regional do Trabalho (TRT)','Justiça do Trabalho',            'Analista e Técnico Judiciário', 'tribunais'),
  ('Tribunal Regional Eleitoral (TRE)', 'Justiça Eleitoral',               'Analista e Técnico Judiciário', 'tribunais'),
  ('Superior Tribunal de Justiça (STJ)','STJ',                             'Analista e Técnico Judiciário', 'tribunais'),
  ('Tribunal Superior do Trabalho (TST)','TST',                            'Analista e Técnico Judiciário', 'tribunais'),
  ('Prefeitura Municipal',              'Prefeituras',                     'Cargos diversos — nível médio e superior', 'municipal'),
  ('Câmara Municipal',                  'Câmaras Municipais',              'Analista e Técnico Legislativo', 'municipal')
),
-- categoriza quem já existe (sem categoria)
upd as (
  update public.exams e
    set category = n.category, organization = coalesce(e.organization, n.org)
    from nacionais n
    where lower(e.name) = lower(n.name) and e.category is null
    returning e.id
)
-- insere os que faltam
insert into public.exams (name, organization, description, category)
select n.name, n.org, n.descr, n.category
from nacionais n
where not exists (select 1 from public.exams e where lower(e.name) = lower(n.name));

-- 3) Forças Armadas (militar) -------------------------------------
insert into public.exams (name, organization, description, category)
select v.name, v.org, v.descr, 'militar'
from (values
  ('Exército - EsPCEx (Cadetes)',        'Exército Brasileiro',  'Escola Preparatória de Cadetes do Exército'),
  ('Exército - ESA (Sargentos)',         'Exército Brasileiro',  'Escola de Sargentos das Armas'),
  ('Exército - EsFCEx (Oficiais)',       'Exército Brasileiro',  'Formação Complementar — saúde, magistério, etc.'),
  ('Exército - IME (Engenharia)',        'Exército Brasileiro',  'Instituto Militar de Engenharia'),
  ('Marinha - Escola Naval',             'Marinha do Brasil',    'Formação de Oficiais da Marinha'),
  ('Marinha - Colégio Naval',            'Marinha do Brasil',    'Ensino médio militar (CN)'),
  ('Marinha - EAM (Aprendizes)',         'Marinha do Brasil',    'Escola de Aprendizes-Marinheiros'),
  ('Marinha - Fuzileiros Navais (CFN)',  'Marinha do Brasil',    'Corpo de Fuzileiros Navais'),
  ('Aeronáutica - AFA',                  'Força Aérea Brasileira','Academia da Força Aérea — Oficiais'),
  ('Aeronáutica - EEAR (Sargentos)',     'Força Aérea Brasileira','Escola de Especialistas de Aeronáutica'),
  ('Aeronáutica - CIAAR (Oficiais)',     'Força Aérea Brasileira','Centro de Instrução e Adaptação')
) as v(name, org, descr)
where not exists (select 1 from public.exams e where lower(e.name) = lower(v.name));

-- 4) Por ESTADO (cross join estados x tipos) ----------------------
insert into public.exams (name, organization, description, uf, category)
select
  t.prefixo || ' - ' || s.nome   as name,
  t.sigla || s.uf                as organization,
  t.descr                        as description,
  s.uf                           as uf,
  t.category                     as category
from (values
  ('AC','Acre'),('AL','Alagoas'),('AP','Amapá'),('AM','Amazonas'),('BA','Bahia'),
  ('CE','Ceará'),('DF','Distrito Federal'),('ES','Espírito Santo'),('GO','Goiás'),
  ('MA','Maranhão'),('MT','Mato Grosso'),('MS','Mato Grosso do Sul'),('MG','Minas Gerais'),
  ('PA','Pará'),('PB','Paraíba'),('PR','Paraná'),('PE','Pernambuco'),('PI','Piauí'),
  ('RJ','Rio de Janeiro'),('RN','Rio Grande do Norte'),('RS','Rio Grande do Sul'),
  ('RO','Rondônia'),('RR','Roraima'),('SC','Santa Catarina'),('SP','São Paulo'),
  ('SE','Sergipe'),('TO','Tocantins')
) as s(uf, nome)
cross join (values
  ('Tribunal de Justiça',   'TJ',    'Escrevente, Analista e Técnico Judiciário', 'tribunais'),
  ('Ministério Público',    'MP',    'Analista e Técnico do MP',                  'tribunais'),
  ('Defensoria Pública',    'DPE-',  'Analista, Técnico e Defensor Público',      'tribunais'),
  ('Polícia Civil',         'PC',    'Investigador, Escrivão e Delegado',         'seguranca'),
  ('Polícia Militar',       'PM',    'Soldado e Oficial',                         'seguranca'),
  ('Corpo de Bombeiros',    'CBM',   'Soldado e Oficial',                         'seguranca'),
  ('Polícia Penal',         'PP-',   'Policial Penal',                            'seguranca'),
  ('SEFAZ (Auditor Fiscal)','SEFAZ-','Auditor Fiscal da Receita Estadual',        'fiscal'),
  ('Tribunal de Contas',    'TCE-',  'Auditor, Analista e Técnico de Controle',   'controle'),
  ('Assembleia Legislativa','ALE-',  'Analista e Técnico Legislativo',            'legislativo'),
  ('DETRAN',                'DETRAN-','Assistente e Analista de Trânsito',         'transito')
) as t(prefixo, sigla, descr, category)
where not exists (
  select 1 from public.exams e where lower(e.name) = lower(t.prefixo || ' - ' || s.nome)
);

-- 5) Situação padrão do edital para quem ainda não tem (pré-edital) -
update public.exams set edital_status = 'previsto' where edital_status is null;
