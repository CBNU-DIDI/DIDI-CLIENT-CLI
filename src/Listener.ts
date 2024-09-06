import type { Alice } from './Alice'
import {Key as AskarKey, KeyAlgs} from '@hyperledger/aries-askar-shared'
import type { AliceInquirer } from './AliceInquirer'
import type {
  Agent,
  BasicMessageStateChangedEvent,
  CredentialExchangeRecord,
  CredentialStateChangedEvent,
  ProofExchangeRecord,
  ProofStateChangedEvent,
} from '@aries-framework/core'
import type BottomBar from 'inquirer/lib/ui/bottom-bar'

import { Buffer as ariesBuffer, isValidPrivateKey, KeyType } from '@aries-framework/core'
import { CustomRecord} from './interfaces/record'
import {
  BasicMessageEventTypes,
  BasicMessageRole,
  CredentialEventTypes,
  CredentialState,
  DidRecord,
  ProofEventTypes,
  ProofState,
} from '@aries-framework/core'
import { ui } from 'inquirer'

import { Color, purpleText } from './OutputClass'
import { toBase64 } from './utils'

export class Listener {
  public on: boolean
  private ui: BottomBar

  public constructor() {
    this.on = false
    this.ui = new ui.BottomBar()
  }

  private printCredentialAttributes(credentialRecord: CredentialExchangeRecord) {
    if (credentialRecord.credentialAttributes) {
      const attribute = credentialRecord.credentialAttributes
      console.log('\n\nCredential preview:')
      attribute.forEach((element) => {
        console.log(purpleText(`${element.name} ${Color.Reset}${element.value}`))
      })
    }
  }

  private async newCredentialPrompt(credentialRecord: CredentialExchangeRecord, aliceInquirer: AliceInquirer) {
    this.printCredentialAttributes(credentialRecord)
    this.turnListenerOn()
    await aliceInquirer.acceptCredentialOffer(credentialRecord)
    this.turnListenerOff()
    await aliceInquirer.processAnswer()
  }

  public turnListenerOn() {
    this.on = true
  }

  public turnListenerOff() {
    this.on = false
  }

  public credentialOfferListener(alice: Alice, aliceInquirer: AliceInquirer) {
    alice.agent.events.on(
      CredentialEventTypes.CredentialStateChanged,
      async ({ payload }: CredentialStateChangedEvent) => {
        if (payload.credentialRecord.state === CredentialState.OfferReceived) {
          await this.newCredentialPrompt(payload.credentialRecord, aliceInquirer)
        }
      }
    )
  }

  public async messageListener(alice: Alice, name: string) : Promise<any> {
    alice.agent.events.on(BasicMessageEventTypes.BasicMessageStateChanged, async (event: BasicMessageStateChangedEvent) => {
      if (event.payload.basicMessageRecord.role === BasicMessageRole.Receiver) {
        this.ui.updateBottomBar(purpleText(`\n${name} received a message: ${event.payload.message.content}\n`))
        //did auth를 위한 문자열 수신
        try{
          const jsonObject = JSON.parse(event.payload.message.content);
          if (jsonObject.hasOwnProperty("DIDMessage")){
            const record = await alice.storage.getById(alice.agent.context,CustomRecord,"key") as unknown as DidRecord
            const val = record.metadata.get("privateKey") as Array<string>;
            const privateKey = val[0].split(',');
            const secretKey = new ariesBuffer(privateKey)
            if(isValidPrivateKey(secretKey,KeyType.Ed25519)){
              const key = AskarKey.fromSecretBytes({secretKey:secretKey,algorithm:KeyAlgs.Ed25519})
              const signature = toBase64(key.signMessage({message:new Uint8Array(jsonObject.DIDMessage)}))
              const message = {
                did: alice.did,
                signature,
              }
              alice.sendMessage(JSON.stringify(message));
            }else{
              new Error("invalid private key")
            } 
          }
          else if(jsonObject.hasOwnProperty("voteMessage")){
            console.log(jsonObject.voteMessage);
            /*TODO:: 사용자가 후보를 선택하도록 변경 */
            alice.sendMessage("12");
          }
        }catch (err){
          console.log(err);
        }
      }
    })
  }

  private async newProofRequestPrompt(proofRecord: ProofExchangeRecord, aliceInquirer: AliceInquirer) {
    this.turnListenerOn()
    await aliceInquirer.acceptProofRequest(proofRecord)
    this.turnListenerOff()
    await aliceInquirer.processAnswer()
  }

  public proofRequestListener(alice: Alice, aliceInquirer: AliceInquirer) {
    alice.agent.events.on(ProofEventTypes.ProofStateChanged, async ({ payload }: ProofStateChangedEvent) => {
      if (payload.proofRecord.state === ProofState.RequestReceived) {
        await this.newProofRequestPrompt(payload.proofRecord, aliceInquirer)
      }
    })
  }
}
