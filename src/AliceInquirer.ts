import type { CredentialExchangeRecord, ProofExchangeRecord } from '@aries-framework/core'

import { clear } from 'console'
import { textSync } from 'figlet'
import { prompt } from 'inquirer'

import { Alice } from './Alice'
import { BaseInquirer, ConfirmOptions } from './BaseInquirer'
import { Listener } from './Listener'
import { Title, greenText, purpleText } from './OutputClass'

import * as readline from 'readline';

const questionAsync=(prompt:string):Promise<string>=>{
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise<string>((resolve)=>{
        rl.question(prompt,(answer)=>{
          rl.close();
          resolve(answer);
        })
    })
}


export const runAlice = async () => {
  clear()
  console.log(textSync('DIDI', { horizontalLayout: 'full', font:'Doh'}))
  const alice = await AliceInquirer.build()
  await alice.processAnswer()
}

enum PromptOptions {
  ReceiveConnectionUrl = 'Receive connection invitation',
  GetCredentials = 'Get Credentials',
  DeleteCredentials = 'Delete Credentials',
  SendMessage = 'Send message',
  GetPresentationRecord= 'Get Presentation Record',
  Exit = 'Exit',
  Restart = 'Restart'  
}

export class AliceInquirer extends BaseInquirer {
  public alice: Alice
  public promptOptionsString: string[]
  public listener: Listener

  public constructor(alice: Alice) {
    super()
    this.alice = alice
    this.listener = new Listener()
    this.promptOptionsString = Object.values(PromptOptions)
    this.listener.messageListener(this.alice, this.alice.name)
  }

  public static async build(): Promise<AliceInquirer> {
    const walletName= await questionAsync('wallet 이름을 입력해주세요');
    const walletPw= await questionAsync('wallet 비밀번호를 입력해주세요');
    console.log(greenText("Agent 생성 중..."));
    const alice = await Alice.build(walletName, walletPw)
    return new AliceInquirer(alice)
  }

  private async getPromptChoice() {
    if (this.alice.connectionRecordFaberId) return prompt([this.inquireOptions(this.promptOptionsString)])

    const reducedOption = [PromptOptions.ReceiveConnectionUrl, PromptOptions.Exit, PromptOptions.Restart, PromptOptions.GetCredentials, PromptOptions.DeleteCredentials, PromptOptions.GetPresentationRecord]
    return prompt([this.inquireOptions(reducedOption)])
  }

  public async processAnswer() {

    if (this.listener.on) {
      console.log(greenText(`처리중...`));
      return
    }
    const choice = await this.getPromptChoice()

    switch (choice.options) {
      case PromptOptions.ReceiveConnectionUrl:
        clear()
        await this.connection()
        break
      case PromptOptions.SendMessage:
        await this.message()
        break
      case PromptOptions.GetCredentials:
        await this.getCredentials()
        break
        
      case PromptOptions.DeleteCredentials:
        await this.deleteCredentials()
        break
      case PromptOptions.GetPresentationRecord:
        await this.getPresentationRecord()
        break
      case PromptOptions.Exit:
        await this.exit()
        clear()
        break
      case PromptOptions.Restart:
        await this.restart()
        return
    }
    
    await this.processAnswer()
  }

  public async getPresentationRecord(){
    const result = await this.alice.agent.proofs.getAll()

    result.forEach((el)=>{
      console.log(`\n${JSON.stringify(el)}\n`)
    })
    return
  }
  public async deleteCredentials(){
    const hasCred = await this.getCredentials();
    if(hasCred){
      const title = Title.DeleteCredentialTitle;
      const choice = await prompt([this.inquireInput(title)]);
      await this.alice.agent.credentials.deleteById(choice.input);
    }
    else{
      console.log(purpleText("\nYou do not have any Verifiable Credentials\n"))
      return
    }
   
  }
  public async getCredentials(){
    const credentials = await this.alice.agent.credentials.getAll();
    const lenCred = credentials.length
    if (lenCred==0){
      return null
    }
    credentials.forEach((el)=>{
      console.log("[id]:",el.id);
      console.log(el.credentialAttributes);
      console.log("======================================\n");
    })
    return lenCred
  }

  public async acceptCredentialOffer(credentialRecord: CredentialExchangeRecord) {
    const confirm = await prompt([this.inquireConfirmation(Title.CredentialOfferTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.alice.agent.credentials.declineOffer(credentialRecord.id)
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.alice.acceptCredentialOffer(credentialRecord)
    }
  }

  public async acceptProofRequest (proofRecord: ProofExchangeRecord) {
    const requestedCredentials = await this.alice.agent.proofs.getCredentialsForRequest({
      proofRecordId: proofRecord.id,
    })

    const selectMap = new Map();
    const formatMap = new Map();
    
    for (const [idx, vc] of requestedCredentials.proofFormats.anoncreds!.attributes['vc'].entries()){
      selectMap.set(idx,vc.credentialInfo.attributes);
      formatMap.set(idx,vc);
    }

    let choiceString = ''; 

    for (const [key, value] of selectMap) {
      choiceString += `${key+1}: `;  
      choiceString += `${JSON.stringify(value)}\n`;   
      choiceString += "============================\n";
    }

    const confirm = await prompt([this.inquireConfirmation(Title.ProofRequestTitle)]);
    if(confirm.options === ConfirmOptions.No){
      await this.alice.agent.proofs.declineRequest({ proofRecordId: proofRecord.id })
    }else if(confirm.options === ConfirmOptions.Yes){
        console.log(purpleText("\n"+choiceString));
        const confirm = await prompt([this.inquireInput(Title.ProofChoiceTitle)]);
        const choice = parseInt(confirm.input,10);
        if (choice && choice <= selectMap.size) {
          console.log(greenText(`VP 제출중...`))
          await this.alice.acceptProofRequest(proofRecord,formatMap.get(choice-1));
        } else{
          await this.alice.agent.proofs.declineRequest({ proofRecordId: proofRecord.id })
        }
    }
  }

  public async connection() {
    const title = Title.InvitationTitle
    const getUrl = await prompt([this.inquireInput(title)])
    await this.alice.acceptConnection(getUrl.input)
    this.listener.turnListenerOn();
    if (!this.alice.connected) return
    this.listener.credentialOfferListener(this.alice, this)
    this.listener.proofRequestListener(this.alice, this)
  }

  public async message() {
    const message = await this.inquireMessage()
    if (!message) return

    await this.alice.sendMessage(message)
  }

  public async exit() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.alice.exit()
    }
  }

  public async restart() {
    const confirm = await prompt([this.inquireConfirmation(Title.ConfirmTitle)])
    if (confirm.options === ConfirmOptions.No) {
      await this.processAnswer()
      return
    } else if (confirm.options === ConfirmOptions.Yes) {
      await this.alice.restart()
      await runAlice()
    }
  }
}

void runAlice()