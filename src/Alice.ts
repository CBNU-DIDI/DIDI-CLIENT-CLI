import type { BaseRecordConstructor, ConnectionRecord, CredentialExchangeRecord, ProofExchangeRecord, TagsBase,SelectCredentialsForProofRequestReturn,DidCreateResult } from '@aries-framework/core'

import { Buffer as ariesBuffer } from '@aries-framework/core'
import { BaseAgent } from './BaseAgent'
import { greenText, Output, redText } from './OutputClass'
import {AskarStorageService,AskarWallet} from '@aries-framework/askar'
import { AgentContext, BaseRecord,InjectionSymbols,KeyType,TypedArrayEncoder,SigningProviderRegistry, isValidPrivateKey } from '@aries-framework/core';
import { AnonCredsLinkSecretRepository } from '@aries-framework/anoncreds';
import {Key as AskarKey, KeyAlgs} from '@hyperledger/aries-askar-shared'
import {randomBytes,generateKeyPairSync,sign,verify, KeyLike} from 'crypto'
import { IItemObject } from './interfaces/IItemObject'
import { CustomRecord } from './interfaces/record'
import { asArray } from '@aries-framework/core/build/utils'


export class Alice extends BaseAgent {
  public did:string
  public storage:AskarStorageService<CustomRecord>
  public connected: boolean
  public connectionRecordFaberId?: string
  public oobId: string

  public constructor(port: number, name: string, pw:string) {
    super({ port, name, pw })
    this.connected = false
    this.did="";
    this.oobId="";
    this.storage = new AskarStorageService
  }

  public static async build(walletName:string, walletPw:string): Promise<Alice> {
    const alice = new Alice(3006, walletName, walletPw)
    await alice.initializeAgent();

    // console.log(await alice.agent.proofs.getAll());
    // const requestedCredentials = await alice.agent.proofs.getCredentialsForRequest({
    //   proofRecordId: 'e1e8454c-65b7-40e3-9f0a-51de8898bef9'
    // }

    const record = await alice.getDids();
    if(record.length===0) {
      alice.did = await alice.createDid();
      console.log(alice.did)
    }
    else{
      alice.did=record[0]["did"];
      console.log(alice.did);
    }
  
    //const linkSecretRepository = alice.agent.context.dependencyManager.resolve(AnonCredsLinkSecretRepository);
    // await linkSecretRepository.findDefault(alice.agent.context);
    // await linkSecretRepository.deleteById(alice.agent.context,"0a44a42a-f799-44cb-a302-2cb7ba2a7b04")
    // const res = await linkSecretRepository.findByQuery(alice.agent.context,{"isDefault":true})
    // console.log(res)
    return alice
  }

  public async getDids(){
    const record = await this.agent.dids.getCreatedDids({method:"indy"}); // indy did record를 getCreatedDids 전부
    return record;
  }
  public async createDid():Promise<string>{
    /*
      did값을 넣으면 외부에서 생성한 did를 import할 수 있다. internal 방식으로 create할려면 endoser의 did와 seed가 wallet에 등록되어잇어야한다.
      1회만 시행하면됨.
    */
    await this.agent.dids.import({ 
      did:process.env.BCOVRINENDORSERDID as string,
      privateKeys: [
        {
          keyType: KeyType.Ed25519,
          privateKey: TypedArrayEncoder.fromString(process.env.BCOVRINSEED as string),
        },
      ],
      overwrite:true,
    });

    const buffer = randomBytes(32);
    const randomKeyBuffer = new ariesBuffer(buffer);
    const key = AskarKey.fromSecretBytes({secretKey:randomKeyBuffer,algorithm:KeyAlgs.Ed25519});
    this.saveItems("key",{publicKey:key.publicBytes.toString(),privateKey:key.secretBytes.toString()});
    const indyDocument: DidCreateResult = await this.agent.dids.create({
      method: 'indy',
      // the secret contains a the verification method type and id
      options:{
        endorserDid: process.env.BCOVRINENDORSERDID,
        endorserMode:'internal',
      },
      secret:{
        privateKey:randomKeyBuffer
      },
    });
    // did의 namespaceIdentifer는 publicKey에 대해 sha-256해시함수를 적용하고 처음 16바이트에 대해 Base58로 인코딩한결과
    const did :string = indyDocument.didState.did as string;
    return did;
  }
  private async saveItems(id:string,item:IItemObject){
    const record:BaseRecord = new CustomRecord
    record.id= id;
    for(const [key,val] of Object.entries(item)){
      record.metadata.set(key,[val])
    }
    this.save(record);
  }

  private async save(record:BaseRecord){
    this.storage.save(this.agent.context,record);
  }
  
  private async getById(recordClass:BaseRecordConstructor<CustomRecord>, id:string):Promise<BaseRecord<TagsBase,TagsBase,{}>  | null>{
    let record;
    try{
      record = await this.storage.getById(this.agent.context,recordClass,id);
      console.log(record.metadata);
    }catch{
      record=null
    }
    return record
  }

  private async deleteById(id:string){
    const record:BaseRecord = new CustomRecord();
    record.id=id;
    const res = await this.storage.delete(this.agent.context,record)
  }

  private async getConnectionRecord() {
    if (!this.connectionRecordFaberId) {
      throw Error(redText(Output.MissingConnectionRecord))
    }
    return await this.agent.connections.getById(this.connectionRecordFaberId)
  }

  private async receiveConnectionRequest(invitationUrl: string) {

    const{ outOfBandRecord,connectionRecord }= await this.agent.oob.receiveInvitationFromUrl(invitationUrl);
    this.oobId = outOfBandRecord.id;
    if (!connectionRecord) {
      throw new Error(redText(Output.NoConnectionRecordFromOutOfBand))
    }
    return connectionRecord
  }

  private async waitForConnection(connectionRecord: ConnectionRecord) {
    connectionRecord = await this.agent.connections.returnWhenIsConnected(connectionRecord.id)
    this.connected = true
    console.log(greenText(Output.ConnectionEstablished))
    return connectionRecord.id
  }

  public async acceptConnection(invitation_url: string) {
    const connectionRecord = await this.receiveConnectionRequest(invitation_url)
    this.connectionRecordFaberId = await this.waitForConnection(connectionRecord)
  }

  public async acceptCredentialOffer(credentialRecord: CredentialExchangeRecord) {
    await this.agent.credentials.acceptOffer({
      credentialRecordId: credentialRecord.id,
    })
  }

  public async acceptProofRequest(proofRecord: ProofExchangeRecord, requestedCredentials:SelectCredentialsForProofRequestReturn) {

    await this.agent.proofs.acceptRequest({
      proofRecordId: proofRecord.id,
      proofFormats: requestedCredentials.proofFormats,
    })
    console.log(greenText('\nProof request accepted!\n'))
  }

  public async sendMessage(message: string) {
    const connectionRecord = await this.getConnectionRecord()
    await this.agent.basicMessages.sendMessage(connectionRecord.id, message)
  }

  public async exit() {
    console.log(Output.Exit)
    if(this.oobId){
      await this.agent.oob.deleteById(this.oobId);
    }
    await this.agent.shutdown()
    process.exit(0)
  }

  public async restart() {
    if(this.oobId){
      await this.agent.oob.deleteById(this.oobId);
    }
    await this.agent.shutdown()
  }
}